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
import { CampaignDetail, MapData, useSaveCampaignMap, useGetGovernance } from '@workspace/api-client-react';
import ActivityNode from './ActivityNode';
import { Button } from '@/components/ui/button';
import { Save, CheckCircle2, Loader2, AlertCircle, Plus, LayoutGrid, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const nodeTypes = {
  activity: ActivityNode,
};

function FlowCanvas({ campaign }: { campaign: CampaignDetail }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('saved');
  const [selectedElement, setSelectedElement] = useState<{ type: 'node' | 'edge'; id: string } | null>(null);
  
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const initializedId = useRef<string | null>(null);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  
  const { data: governance } = useGetGovernance();
  const { mutate: saveMap } = useSaveCampaignMap();

  useEffect(() => {
    if (campaign && initializedId.current !== campaign.id) {
      initializedId.current = campaign.id;
      
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
      
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    }
  }, [campaign, fitView]);

  const triggerSave = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    setSaveStatus('saving');
    
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    saveTimeout.current = setTimeout(() => {
      const mapData: MapData = {
        activities: newNodes.map(n => ({
          ...n.data as any,
          position: n.position
        })),
        connections: newEdges.map(e => ({
          ...e.data as any,
          source: e.source,
          target: e.target,
          id: e.id,
        }))
      };

      saveMap({ id: campaign.id, data: mapData }, {
        onSuccess: () => setSaveStatus('saved'),
        onError: () => {
          setSaveStatus('error');
          toast({ title: 'Failed to save map', variant: 'destructive' });
        }
      });
    }, 1000);
  }, [campaign.id, saveMap, toast]);

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
        const newEdge: Edge = { 
          ...params, 
          id: `e-${params.source}-${params.target}-${Date.now()}`,
          animated: true,
          style: { strokeWidth: 2, stroke: 'hsl(var(--primary))' },
          data: {
            id: `e-${params.source}-${params.target}-${Date.now()}`,
            source: params.source,
            target: params.target,
            trigger: 'Response',
            timing: 'Immediate',
            exclusions: [],
            sentence: 'On Response, Immediate'
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

      const newNode: Node = {
        id: uuidv4(),
        type: 'activity',
        position,
        data: {
          id: uuidv4(),
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
        const next = nds.concat(newNode);
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
              {saveStatus === 'saving' && <><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> <span className="text-muted-foreground">Saving...</span></>}
              {saveStatus === 'saved' && <><CheckCircle2 className="h-4 w-4 text-green-500" /> <span className="text-muted-foreground">Saved</span></>}
              {saveStatus === 'error' && <><AlertCircle className="h-4 w-4 text-destructive" /> <span className="text-destructive font-medium">Failed</span></>}
              {saveStatus === 'idle' && <><Save className="h-4 w-4 text-muted-foreground" /> <span className="text-muted-foreground">Idle</span></>}
            </div>
          </Panel>
        </ReactFlow>

        {/* Config Drawer */}
        {selectedElement && (
          <div className="w-80 bg-card border-l border-border h-full flex flex-col absolute right-0 top-0 shadow-xl animate-in slide-in-from-right-8 z-20">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
              <h3 className="font-semibold text-sm">
                {selectedElement.type === 'node' ? 'Activity Configuration' : 'Rule Builder'}
              </h3>
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => setSelectedElement(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              {selectedElement.type === 'node' && selectedNode && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Activity Name</Label>
                    <Input 
                      value={String(selectedNode.data.name || '')}
                      onChange={(e) => updateSelectedNodeData('name', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Audience</Label>
                    <Input 
                      value={String(selectedNode.data.audience || '')}
                      onChange={(e) => updateSelectedNodeData('audience', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <select 
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={String(selectedNode.data.status || 'Estimated')}
                      onChange={(e) => updateSelectedNodeData('status', e.target.value)}
                    >
                      <option value="Decision needed">Decision needed</option>
                      <option value="Estimated">Estimated</option>
                      <option value="Known">Known</option>
                      <option value="Confirmed">Confirmed</option>
                    </select>
                  </div>
                  {Boolean(selectedNode.data.conflict) && (
                    <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20 text-sm">
                      <div className="font-semibold text-destructive flex items-center gap-1.5 mb-1">
                        <AlertCircle className="h-4 w-4" /> Conflict Flagged
                      </div>
                      <div className="text-destructive/80 text-xs">
                        This activity overlaps with a portfolio-wide restriction. Check Portfolio tab for details.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selectedElement.type === 'edge' && selectedEdge && (
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
