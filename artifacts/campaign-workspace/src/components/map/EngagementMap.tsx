import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  applyNodeChanges, 
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  Connection as FlowConnection,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  NodeMouseHandler,
  EdgeMouseHandler
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CampaignDetail,
  MapInput,
  useSaveCampaignMap,
  useGetGovernance,
  useGetCampaignDelivery,
  getGetCampaignQueryKey,
  getGetCampaignDeliveryQueryKey,
  getListWebinarsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import ActivityNode from './ActivityNode';
import ActivityConfigDrawer from './ActivityConfigDrawer';
import WebinarSetupDialog from './WebinarSetupDialog';
import type { WebinarSetup } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Save, CheckCircle2, Loader2, AlertCircle, Plus, LayoutGrid, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const nodeTypes = {
  activity: ActivityNode,
};

function FlowCanvas({ campaign }: { campaign: CampaignDetail }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('saved');
  const [selectedElement, setSelectedElement] = useState<{ type: 'node' | 'edge'; id: string } | null>(null);
  const [webinarSetupDrop, setWebinarSetupDrop] = useState<{ position: any, type: string } | null>(null);
  const [webinarSetupError, setWebinarSetupError] = useState('');
  const [webinarSetupSaving, setWebinarSetupSaving] = useState(false);
  
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const initializedId = useRef<string | null>(null);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestMap = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const saveGeneration = useRef(0);
  const saveBlocked = useRef(false);
  const saveCompletion = useRef<{
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  } | null>(null);
  const [conflictFrozen, setConflictFrozen] = useState(false);
  const campaignVersion = useRef<number>((campaign as any).rowVersion ?? 1);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const queryClient = useQueryClient();
  
  const { data: governance } = useGetGovernance();
  const { mutate: saveMap } = useSaveCampaignMap();
  const { data: delivery } = useGetCampaignDelivery(campaign.id, {
    query: { enabled: !!campaign.id, queryKey: getGetCampaignDeliveryQueryKey(campaign.id) }
  });

  const hydrateFromCampaign = useCallback(() => {
    const initialNodes: Node[] = campaign.map.activities.map(act => ({
      id: act.id,
      type: 'activity',
      position: act.position,
      data: act as unknown as Record<string, unknown>,
    }));
    const initialEdges: Edge[] = campaign.map.connections.map(conn => ({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      label: conn.trigger || undefined,
      data: conn as unknown as Record<string, unknown>,
      animated: true,
      style: { strokeWidth: 2, stroke: 'hsl(var(--primary))' },
    }));
    setNodes(initialNodes);
    setEdges(initialEdges);
    campaignVersion.current = (campaign as any).rowVersion ?? 1;
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [campaign, fitView]);

  useEffect(() => {
    if (campaign && initializedId.current !== campaign.id) {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveGeneration.current += 1;
      saveBlocked.current = false;
      latestMap.current = null;
      saveCompletion.current = null;
      saveQueue.current = Promise.resolve();
      setConflictFrozen(false);
      setSaveStatus('saved');
      initializedId.current = campaign.id;
      hydrateFromCampaign();
    }
  }, [campaign, hydrateFromCampaign]);

  useEffect(() => {
    if (delivery) {
      setNodes(nds => nds.map(n => ({
        ...n,
        data: {
          ...n.data,
          communications: delivery.communications.filter(c => c.activityId === n.id),
          tasks: delivery.tasks.filter(t => t.activityId === n.id)
        }
      })));
    }
  }, [delivery]);

  const enqueueSave = useCallback((newNodes: Node[], newEdges: Edge[], completion?: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  }) => {
    if (saveBlocked.current) return;
    if (completion) saveCompletion.current = completion;
    latestMap.current = { nodes: newNodes, edges: newEdges };
    const generation = saveGeneration.current;
    saveQueue.current = saveQueue.current.then(() => new Promise<void>((resolve) => {
      if (saveBlocked.current || generation !== saveGeneration.current) {
        resolve();
        return;
      }
      const currentMap = latestMap.current ?? { nodes: newNodes, edges: newEdges };
      const mapData: MapInput = {
        rowVersion: campaignVersion.current,
        activities: currentMap.nodes.map(n => {
          const { communications, tasks, ...restData } = n.data as any;
          return { ...restData, id: n.id, position: n.position };
        }),
        connections: currentMap.edges.map(e => ({
          ...e.data as any,
          source: e.source,
          target: e.target,
          id: e.id,
        }))
      };
      saveMap({ id: campaign.id, data: mapData }, {
        onSuccess: (saved: any) => {
          if (generation !== saveGeneration.current) {
            resolve();
            return;
          }
          campaignVersion.current = Number(saved?.rowVersion ?? campaignVersion.current + 1);
          const savedVersions = new Map<string, number>(
            (saved?.activities ?? []).map((activity: any) => [activity.id, activity.rowVersion]),
          );
          setNodes((current) => current.map((node) => {
            const rowVersion = savedVersions.get(node.id);
            return rowVersion ? { ...node, data: { ...node.data, rowVersion } } : node;
          }));
          if (latestMap.current) {
            latestMap.current = {
              ...latestMap.current,
              nodes: latestMap.current.nodes.map((node) => {
                const rowVersion = savedVersions.get(node.id);
                return rowVersion ? { ...node, data: { ...node.data, rowVersion } } : node;
              }),
            };
          }
          setSaveStatus('saved');
          queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaign.id) });
          queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
          queryClient.invalidateQueries({ queryKey: getListWebinarsQueryKey(campaign.id) });
          const completed = saveCompletion.current;
          saveCompletion.current = null;
          completed?.onSuccess?.();
          resolve();
        },
        onError: (error: any) => {
          if (generation !== saveGeneration.current) {
            resolve();
            return;
          }
          setSaveStatus('error');
          const completed = saveCompletion.current;
          saveCompletion.current = null;
          completed?.onError?.(error);
          const status = error?.response?.status ?? error?.status;
          if (status === 409 || status === 428) {
            // Invalidate every queued snapshot. The local graph remains visible
            // for an explicit discard/reload decision, but no stale payload
            // may be sent again automatically.
            if (saveTimeout.current) clearTimeout(saveTimeout.current);
            saveBlocked.current = true;
            saveGeneration.current += 1;
            latestMap.current = null;
            setConflictFrozen(true);
          }
          toast({
            title: status === 409 || status === 428 ? 'Map changed elsewhere' : 'Failed to save map',
            description: status === 409 || status === 428
              ? 'Reload this campaign before making another change.'
              : undefined,
            variant: 'destructive'
          });
          resolve();
        }
      });
    }));
  }, [campaign.id, queryClient, saveMap, toast]);

  const triggerSave = useCallback((newNodes: Node[], newEdges: Edge[], completion?: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  }) => {
    if (saveBlocked.current) return;
    setSaveStatus('saving');
    if (completion) saveCompletion.current = completion;

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    saveTimeout.current = setTimeout(() => {
      enqueueSave(newNodes, newEdges, completion);
    }, 1000);
  }, [enqueueSave]);

  const discardLocalChanges = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveGeneration.current += 1;
    saveBlocked.current = false;
    latestMap.current = null;
    saveCompletion.current = null;
    saveQueue.current = Promise.resolve();
    setConflictFrozen(false);
    setSaveStatus('saved');
    hydrateFromCampaign();
  }, [hydrateFromCampaign]);

  const reloadCampaign = useCallback(() => {
    window.location.reload();
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const nextNodes = applyNodeChanges(changes, nds);
        if (changes.some(c => c.type === 'position' || c.type === 'remove')) {
          triggerSave(nextNodes, edges);
        }
        return nextNodes;
      });
    },
    [edges, triggerSave]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const nextEdges = applyEdgeChanges(changes, eds);
        if (changes.some(c => c.type === 'remove')) {
          triggerSave(nodes, nextEdges);
        }
        return nextEdges;
      });
    },
    [nodes, triggerSave]
  );

  const onConnect = useCallback(
    (params: FlowConnection) => {
      setEdges((eds) => {
        const id = uuidv4();
        const newEdge: Edge = { 
          ...params, 
          id,
          animated: true,
          style: { strokeWidth: 2, stroke: 'hsl(var(--primary))' },
          data: {
            id,
            source: params.source,
            target: params.target,
            trigger: 'Response',
            timing: 'Immediate',
            exclusions: [],
            sentence: 'On Response, Immediate',
            parentBranchId: null,
            entryCondition: { event: 'Response' },
            suppressionRule: {}
          } as unknown as Record<string, unknown>
        } as Edge;
        const nextEdges = addEdge(newEdge, eds);
        triggerSave(nodes, nextEdges);
        return nextEdges;
      });
    },
    [nodes, triggerSave]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      if (type === 'Webinar') {
        setWebinarSetupDrop({ position, type });
        return;
      }

       const newNode: Node = {
         id: uuidv4(),
        type: 'activity',
        position,
         data: {
          name: `New ${type}`,
          type: type,
          audience: campaign.audience,
          region: campaign.region,
          timing: 'TBD',
          status: 'Estimated',
          owner: 'Unassigned',
          conflict: false,
          position
        } as unknown as Record<string, unknown>,
      };

       setNodes((nds) => {
         const nodeWithMatchingId = { ...newNode, data: { ...newNode.data, id: newNode.id } as unknown as Record<string, unknown> };
         const next = nds.concat(nodeWithMatchingId);
        triggerSave(next, edges);
        return next;
      });
    },
    [screenToFlowPosition, campaign, edges, triggerSave]
  );

  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick: NodeMouseHandler = (_, node) => setSelectedElement({ type: 'node', id: node.id });
  const onEdgeClick: EdgeMouseHandler = (_, edge) => setSelectedElement({ type: 'edge', id: edge.id });
  const onPaneClick = () => setSelectedElement(null);

  const updateSelectedNodeData = (key: string, value: string) => {
    if (selectedElement?.type !== 'node') return;
    setNodes(nds => {
      const next = nds.map(n => {
        if (n.id === selectedElement.id) {
          return { ...n, data: { ...n.data, [key]: value } as unknown as Record<string, unknown> };
        }
        return n;
      });
      triggerSave(next, edges);
      return next;
    });
  };

  const updateSelectedEdgeData = (updates: Record<string, unknown>) => {
    if (selectedElement?.type !== 'edge') return;
    setEdges(eds => {
      const next = eds.map(edge => edge.id === selectedElement.id
        ? { ...edge, data: { ...edge.data as any, ...updates } as unknown as Record<string, unknown> }
        : edge);
      triggerSave(nodes, next);
      return next;
    });
  };

  const selectedNode = selectedElement?.type === 'node' ? nodes.find(n => n.id === selectedElement.id) : null;
  const selectedEdge = selectedElement?.type === 'edge' ? edges.find(e => e.id === selectedElement.id) : null;

  return (
    <div className="flex h-full w-full">
      {/* Activity Library Sidebar */}
      <div className="w-64 bg-card border-r border-border flex flex-col shrink-0 z-10">
        <div className="p-4 border-b border-border bg-muted/20">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <LayoutGrid className="h-4 w-4 text-primary" />
            Activity Library
          </h3>
          <p className="text-xs text-muted-foreground mt-1">Drag governed types onto the map.</p>
        </div>
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3">
            {governance?.activityTypes.map(type => (
              <div 
                key={type}
                draggable
                onDragStart={(e) => onDragStart(e as unknown as DragEvent, type)}
                className="p-3 border border-border rounded-md bg-background text-sm cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm transition-all"
              >
                <div className="font-medium">{type}</div>
                <div className="text-xs text-muted-foreground mt-1">Standard template</div>
              </div>
            ))}
            {!governance && (
              <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 relative flex" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          className="bg-slate-50/50"
        >
          <Background gap={24} size={2} color="hsl(var(--border))" />
          <Controls className="bg-card border-border shadow-sm" />
          
          <Panel position="top-left" className="m-4 flex gap-2">
            <Button variant="outline" size="sm" className="bg-card" onClick={() => fitView({ padding: 0.2, duration: 800 })}>
              <LayoutGrid className="h-4 w-4 mr-2" />
              Fit View
            </Button>
          </Panel>

          <Panel position="top-right" className="m-4">
            <div className="bg-card border border-border shadow-sm rounded-md px-3 py-1.5 flex items-center gap-2 text-sm">
              {conflictFrozen ? (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive font-medium">Reload or discard local changes</span>
                  <Button size="sm" variant="outline" onClick={discardLocalChanges}>Discard</Button>
                  <Button size="sm" onClick={reloadCampaign}>Reload</Button>
                </>
              ) : (
                <>
                  {saveStatus === 'saving' && <><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> <span className="text-muted-foreground">Saving...</span></>}
                  {saveStatus === 'saved' && <><CheckCircle2 className="h-4 w-4 text-green-500" /> <span className="text-muted-foreground">Saved</span></>}
                  {saveStatus === 'error' && <><AlertCircle className="h-4 w-4 text-destructive" /> <span className="text-destructive font-medium">Failed</span></>}
                  {saveStatus === 'idle' && <><Save className="h-4 w-4 text-muted-foreground" /> <span className="text-muted-foreground">Idle</span></>}
                </>
              )}
            </div>
          </Panel>
        </ReactFlow>

        <WebinarSetupDialog
          open={!!webinarSetupDrop}
          onOpenChange={(open) => {
            if (!open) {
              setWebinarSetupDrop(null);
              setWebinarSetupError('');
              setWebinarSetupSaving(false);
            }
          }}
          submitting={webinarSetupSaving}
          error={webinarSetupError}
          onSubmit={(setup: WebinarSetup) => {
            if (!webinarSetupDrop) return;
            setWebinarSetupError('');
            setWebinarSetupSaving(true);
            const newNode: Node = {
              id: uuidv4(),
              type: 'activity',
              position: webinarSetupDrop.position,
              data: {
                name: `New Webinar`,
                type: 'Webinar',
                audience: campaign.audience,
                region: campaign.region,
                timing: 'TBD',
                status: 'Estimated',
                owner: 'Unassigned',
                conflict: false,
                position: webinarSetupDrop.position,
                webinarSetup: setup
              } as unknown as Record<string, unknown>,
            };
            setNodes((nds) => {
              const nodeWithMatchingId = { ...newNode, data: { ...newNode.data, id: newNode.id } as unknown as Record<string, unknown> };
              const next = nds.concat(nodeWithMatchingId);
              triggerSave(next, edges, {
                onSuccess: () => {
                  setWebinarSetupSaving(false);
                  setWebinarSetupDrop(null);
                },
                onError: (error) => {
                  setNodes((current) => current.filter((node) => node.id !== newNode.id));
                  setWebinarSetupSaving(false);
                  setWebinarSetupError(error instanceof Error ? error.message : 'Failed to save webinar setup. Correct the setup and try again.');
                },
              });
              return next;
            });
          }}
        />

        {/* Config Drawer */}
        {selectedElement && selectedElement.type === 'node' && selectedNode && (
          <ActivityConfigDrawer
            campaignId={campaign.id}
            node={selectedNode}
            updateNodeData={updateSelectedNodeData}
            onClose={() => setSelectedElement(null)}
            communications={delivery?.communications.filter(c => c.activityId === selectedNode.id) || []}
            tasks={delivery?.tasks.filter(t => t.activityId === selectedNode.id) || []}
          />
        )}

        {selectedElement && selectedElement.type === 'edge' && (
          <div className="w-80 bg-card border-l border-border h-full flex flex-col absolute right-0 top-0 shadow-xl animate-in slide-in-from-right-8 z-20">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
              <h3 className="font-semibold text-sm">Rule Builder</h3>
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => setSelectedElement(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              {selectedEdge && (
                <div className="space-y-4">
                  <div className="p-3 bg-muted rounded-md text-sm border border-border">
                    <span className="font-medium text-muted-foreground block mb-1">Logic Sentence</span>
                    "{(selectedEdge.data as any)?.sentence || 'If recipient interacts, proceed.'}"
                  </div>
                  <div className="space-y-1.5 mt-4">
                    <Label className="text-xs text-muted-foreground">Trigger</Label>
                    <select 
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={(selectedEdge.data as any)?.trigger || 'Response'}
                      onChange={(e) => {
                         setEdges(eds => {
                           const next = eds.map(edge => {
                             if(edge.id === selectedEdge.id) {
                               return { 
                                 ...edge, 
                                 label: e.target.value,
                                 data: { 
                                   ...edge.data as any, 
                                   trigger: e.target.value,
                                   sentence: `On ${e.target.value}`
                                 } 
                               };
                             }
                             return edge;
                           });
                           triggerSave(nodes, next);
                           return next;
                         });
                      }}
                    >
                      <option value="Response">On Response</option>
                      <option value="No Response">On No Response</option>
                      <option value="Click">On Click</option>
                      <option value="Open">On Open</option>
                      <option value="Time Based">Time Based</option>
                    </select>
                  </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs text-muted-foreground">Parent branch</Label>
                     <select
                       className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                       value={(selectedEdge.data as any)?.parentBranchId || 'none'}
                       onChange={(e) => updateSelectedEdgeData({ parentBranchId: e.target.value === 'none' ? null : e.target.value })}
                     >
                       <option value="none">Root branch</option>
                       {edges.filter(edge => edge.id !== selectedEdge.id).map(edge => (
                         <option key={edge.id} value={edge.id}>
                           {(edge.data as any)?.trigger || edge.id.slice(0, 8)} → {edge.target.slice(0, 8)}
                         </option>
                       ))}
                     </select>
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs text-muted-foreground">Entry condition (JSON)</Label>
                     <Textarea
                       className="min-h-16 text-xs font-mono"
                       defaultValue={JSON.stringify((selectedEdge.data as any)?.entryCondition || {}, null, 2)}
                       onBlur={(e) => {
                         try {
                           updateSelectedEdgeData({ entryCondition: JSON.parse(e.target.value || '{}') });
                         } catch {
                           toast({ title: 'Entry condition must be valid JSON', variant: 'destructive' });
                         }
                       }}
                     />
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs text-muted-foreground">Suppression rule (JSON)</Label>
                     <Textarea
                       className="min-h-16 text-xs font-mono"
                       defaultValue={JSON.stringify((selectedEdge.data as any)?.suppressionRule || {}, null, 2)}
                       onBlur={(e) => {
                         try {
                           updateSelectedEdgeData({ suppressionRule: JSON.parse(e.target.value || '{}') });
                         } catch {
                           toast({ title: 'Suppression rule must be valid JSON', variant: 'destructive' });
                         }
                       }}
                     />
                   </div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EngagementMapWrapper({ campaign }: { campaign: CampaignDetail }) {
  return (
    <div className="w-full h-[calc(100vh-12rem)] relative bg-muted/10 rounded-lg border border-border overflow-hidden">
      <ReactFlowProvider>
        <FlowCanvas campaign={campaign} />
      </ReactFlowProvider>
    </div>
  );
}
