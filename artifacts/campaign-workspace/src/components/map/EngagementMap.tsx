import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import { useSearch, useLocation } from 'wouter';
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
  useCreateActivity,
  useSaveCampaignMap,
  useGetGovernance,
  useGetCampaignDelivery,
  getGetCampaignQueryKey,
  getGetCampaignDeliveryQueryKey,
  getListWebinarsQueryKey,
  useGetActivityModelCatalog,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import ActivityNode from './ActivityNode';
import ConnectionEdge from './ConnectionEdge';
import ActivityConfigDrawer from './ActivityConfigDrawer';
import WebinarSetupDialog from './WebinarSetupDialog';
import type { WebinarSetup } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Save, CheckCircle2, Loader2, AlertCircle, Plus, LayoutGrid, X, Link2, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const nodeTypes = {
  activity: ActivityNode,
};

const edgeTypes = {
  connection: ConnectionEdge,
};

function FlowCanvas({ campaign }: { campaign: CampaignDetail }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('saved');
  const [selectedElement, setSelectedElement] = useState<{ type: 'node' | 'edge'; id: string } | null>(null);
  const [connectionMode, setConnectionMode] = useState<{ sourceId: string | null } | null>(null);
  const [webinarSetupDrop, setWebinarSetupDrop] = useState<{ position: any, type: string } | null>(null);
  const [webinarSetupError, setWebinarSetupError] = useState('');
  const [webinarSetupSaving, setWebinarSetupSaving] = useState(false);
  const [pendingActivity, setPendingActivity] = useState<Node | null>(null);
  
  const { toast } = useToast();
  const search = useSearch();
  const [_, setLocation] = useLocation();
  const searchParams = new URLSearchParams(search);
  const urlActivity = searchParams.get('activity');

  useEffect(() => {
    if (urlActivity && nodes.length > 0 && nodes.some(n => n.id === urlActivity)) {
      setSelectedElement({ type: 'node', id: urlActivity });
      const params = new URLSearchParams(search);
      params.delete('activity');
      setLocation(`/campaigns/${campaign.id}?${params.toString()}`, { replace: true });
    }
  }, [urlActivity, nodes, search, setLocation, campaign.id]);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const initializedId = useRef<string | null>(null);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestMap = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const saveGeneration = useRef(0);
  // Every local graph mutation advances this revision. A response may only
  // replace editable fields when no newer local revision exists.
  const localRevision = useRef(0);
  const saveBlocked = useRef(false);
  const connectionActionRef = useRef<(activityId: string) => void>(() => {});
  const [conflictFrozen, setConflictFrozen] = useState(false);
  const campaignVersion = useRef<number>((campaign as any).rowVersion ?? 1);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const queryClient = useQueryClient();
  
  const { data: governance } = useGetGovernance();
  const { mutate: saveMap } = useSaveCampaignMap();
  const { mutate: createActivity } = useCreateActivity();
  const { data: delivery } = useGetCampaignDelivery(campaign.id, {
    query: { enabled: !!campaign.id, queryKey: getGetCampaignDeliveryQueryKey(campaign.id) }
  });
  const { data: activityCatalog } = useGetActivityModelCatalog();
  const dispatchConnectionAction = useCallback((activityId: string) => {
    connectionActionRef.current(activityId);
  }, []);

  const hydrateFromCampaign = useCallback(() => {
    const initialNodes: Node[] = campaign.map.activities.map(act => ({
      id: act.id,
      type: 'activity',
      position: act.position,
      data: {
        ...act,
        connectionSourceId: connectionMode?.sourceId,
        onConnectionAction: dispatchConnectionAction,
      } as unknown as Record<string, unknown>,
    }));
    const initialEdges: Edge[] = campaign.map.connections.map(conn => ({
      id: conn.id,
      type: 'connection',
      source: conn.source,
      target: conn.target,
      label: conn.trigger || undefined,
      data: conn as unknown as Record<string, unknown>,
      animated: true,
      interactionWidth: 36,
      deletable: true,
      style: { strokeWidth: 2, stroke: 'hsl(var(--primary))' },
    }));
    setNodes(initialNodes);
    setEdges(initialEdges);
    campaignVersion.current = (campaign as any).rowVersion ?? 1;
  }, [campaign, connectionMode?.sourceId, dispatchConnectionAction]);

  useEffect(() => {
    if (campaign && initializedId.current !== campaign.id) {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveGeneration.current += 1;
      saveBlocked.current = false;
      latestMap.current = null;
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
    const generation = saveGeneration.current;
    saveQueue.current = saveQueue.current.then(() => new Promise<void>((resolve) => {
      if (saveBlocked.current || generation !== saveGeneration.current) {
        resolve();
        return;
      }
      const currentMap = latestMap.current ?? { nodes: newNodes, edges: newEdges };
      const requestRevision = localRevision.current;
      const mapData: MapInput = {
        rowVersion: campaignVersion.current,
        activities: currentMap.nodes.map(n => {
          const {
            communications,
            tasks,
            connectionSourceId,
            onConnectionAction,
            ...restData
          } = n.data as any;
          const activity = { ...restData, id: n.id, position: n.position };
          if (activity.activityTypeId && !activity.rowVersion) {
            delete activity.name;
            delete activity.generatedName;
          }
          return activity;
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
          const savedActivities = new Map<string, any>(
            (saved?.activities ?? []).map((activity: any) => [activity.id, activity]),
          );
           const hasNewerLocalChanges = localRevision.current !== requestRevision;
           setNodes((current) => current.map((node) => {
            const savedAct = savedActivities.get(node.id);
            if (!savedAct) return node;
            return {
              ...node,
              data: {
                ...node.data,
                 ...(hasNewerLocalChanges
                   ? (savedAct.activityTypeId ? {
                       name: savedAct.name,
                       generatedName: savedAct.generatedName,
                       effectiveInheritance: savedAct.effectiveInheritance,
                     } : {})
                   : savedAct),
                rowVersion: savedAct.rowVersion,
                communications: node.data.communications,
                tasks: node.data.tasks,
                connectionSourceId: node.data.connectionSourceId,
                onConnectionAction: node.data.onConnectionAction
              }
            };
          }));
           if (latestMap.current) {
            latestMap.current = {
              ...latestMap.current,
              nodes: latestMap.current.nodes.map((node) => {
                const savedAct = savedActivities.get(node.id);
                if (!savedAct) return node;
                return {
                  ...node,
                  data: {
                    ...node.data,
                     ...(hasNewerLocalChanges
                       ? (savedAct.activityTypeId ? {
                           name: savedAct.name,
                           generatedName: savedAct.generatedName,
                           effectiveInheritance: savedAct.effectiveInheritance,
                         } : {})
                       : savedAct),
                    rowVersion: savedAct.rowVersion,
                    communications: node.data.communications,
                    tasks: node.data.tasks,
                    connectionSourceId: node.data.connectionSourceId,
                    onConnectionAction: node.data.onConnectionAction
                  }
                };
              }),
            };
          }
          setSaveStatus('saved');
          queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaign.id) });
          queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
          queryClient.invalidateQueries({ queryKey: getListWebinarsQueryKey(campaign.id) });
           completion?.onSuccess?.();
          resolve();
        },
        onError: (error: any) => {
          if (generation !== saveGeneration.current) {
            resolve();
            return;
          }
          setSaveStatus('error');
           completion?.onError?.(error);
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
    localRevision.current += 1;
    latestMap.current = { nodes: newNodes, edges: newEdges };
    setSaveStatus('saving');
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

  const connectActivities = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      toast({
        title: 'Choose two different activities',
        description: 'An activity cannot connect to itself.',
        variant: 'destructive',
      });
      return;
    }
    if (edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
      toast({
        title: 'Connection already exists',
        description: 'Choose another target or edit the existing connection.',
        variant: 'destructive',
      });
      return;
    }

    const id = uuidv4();
    const newEdge: Edge = {
      id,
      type: 'connection',
      source: sourceId,
      target: targetId,
      label: 'Response',
      animated: true,
      interactionWidth: 36,
      deletable: true,
      style: { strokeWidth: 2, stroke: 'hsl(var(--primary))' },
      data: {
        id,
        source: sourceId,
        target: targetId,
        trigger: 'Response',
        timing: 'Immediate',
        exclusions: [],
        sentence: 'On Response, Immediate',
        parentBranchId: null,
        entryCondition: { event: 'Response' },
        suppressionRule: {},
      } as unknown as Record<string, unknown>,
    };

    setEdges((currentEdges) => {
      const nextEdges = addEdge(newEdge, currentEdges);
      // addEdge also guards against duplicate source/target pairs if another
      // pointer event arrives before React has committed the first update.
      if (nextEdges.length === currentEdges.length) return currentEdges;
      triggerSave(nodes, nextEdges);
      return nextEdges;
    });
    setConnectionMode(null);
    setSelectedElement({ type: 'edge', id });
  }, [edges, nodes, toast, triggerSave]);

  const onConnect = useCallback(
    (params: FlowConnection) => {
      if (params.source && params.target) {
        connectActivities(params.source, params.target);
      }
    },
    [connectActivities]
  );

  const onConnectionAction = useCallback((activityId: string) => {
    if (!connectionMode || !connectionMode.sourceId) {
      setSelectedElement(null);
      setConnectionMode({ sourceId: activityId });
      return;
    }
    if (connectionMode.sourceId === activityId) {
      setConnectionMode(null);
      return;
    }
    connectActivities(connectionMode.sourceId, activityId);
  }, [connectActivities, connectionMode]);

  useEffect(() => {
    connectionActionRef.current = onConnectionAction;
  }, [onConnectionAction]);

  // Interaction callbacks live on the React Flow node only. They are removed
  // in enqueueSave so no UI functions can leak into the map API payload.
  useEffect(() => {
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        connectionSourceId: connectionMode?.sourceId,
        onConnectionAction: dispatchConnectionAction,
      },
    })));
  }, [connectionMode?.sourceId, dispatchConnectionAction]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const addActivityAtPosition = useCallback((typeId: string, position: { x: number; y: number }) => {
    if (typeId === 'Webinar' || typeId === 'webinar') {
      setWebinarSetupError('');
      setWebinarSetupSaving(false);
      setWebinarSetupDrop({ position, type: typeId });
      return;
    }

    const typeConfig = activityCatalog?.activityTypes.find(t => t.id === typeId);

    const newNode: Node = {
      id: uuidv4(),
      type: 'activity',
      position,
      data: {
        name: '',
        type: typeConfig ? typeConfig.displayName : typeId,
        activityTypeId: typeConfig ? typeId : undefined,
        namingInput: '',
        answers: {},
        overrides: {},
        audience: campaign.audience,
        region: campaign.region,
        timing: 'TBD',
        status: 'Estimated',
        owner: 'Unassigned',
        conflict: false,
        position,
      } as unknown as Record<string, unknown>,
    };

    const draftNode = {
      ...newNode,
      data: { ...newNode.data, id: newNode.id } as unknown as Record<string, unknown>,
    };
    setPendingActivity(draftNode);
    setSelectedElement({ type: 'node', id: draftNode.id });
  }, [campaign.audience, campaign.region, activityCatalog]);

  const positionForLibraryAdd = useCallback(() => {
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const screenPosition = bounds
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const flowPosition = screenToFlowPosition(screenPosition);
    const position = { x: flowPosition.x - 144, y: flowPosition.y - 110 };
    // New cards must not cover existing handles or connections.
    while (nodes.some((node) => (
      position.x < node.position.x + (node.measured?.width ?? 288) + 32
      && position.x + 320 > node.position.x
      && position.y < node.position.y + (node.measured?.height ?? 260) + 32
      && position.y + 292 > node.position.y
    ))) {
      position.y += 320;
    }
    return position;
  }, [nodes, screenToFlowPosition]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addActivityAtPosition(type, position);
    },
    [addActivityAtPosition, screenToFlowPosition]
  );

  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (connectionMode && !connectionMode.sourceId) {
      setConnectionMode({ sourceId: node.id });
      return;
    }
    if (connectionMode?.sourceId) {
      if (connectionMode.sourceId === node.id) {
        setConnectionMode(null);
        return;
      }
      connectActivities(connectionMode.sourceId, node.id);
      return;
    }
    setSelectedElement({ type: 'node', id: node.id });
  };
  const onEdgeClick: EdgeMouseHandler = (_, edge) => setSelectedElement({ type: 'edge', id: edge.id });
  const onPaneClick = () => {
    if (pendingActivity?.id === selectedElement?.id) setPendingActivity(null);
    setSelectedElement(null);
    setConnectionMode(null);
  };

  const updateSelectedNodeData = (key: string, value: any) => {
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

  const saveCanonicalNode = useCallback((updates: Record<string, unknown>, isNew: boolean) => new Promise<void>((resolve, reject) => {
    const draft = isNew ? pendingActivity : nodes.find((node) => node.id === selectedElement?.id);
    if (!draft) {
      reject(new Error('Activity draft is no longer available.'));
      return;
    }
    if (isNew) {
      const data = { ...draft.data, ...updates } as Record<string, any>;
      createActivity({
        id: campaign.id,
        data: {
          rowVersion: campaignVersion.current,
          activityTypeId: String(data.activityTypeId),
          namingInput: data.namingInput === undefined ? undefined : String(data.namingInput),
          answers: data.answers ?? {},
          overrides: data.overrides ?? {},
          audience: String(data.audience ?? campaign.audience),
          region: String(data.region ?? campaign.region),
          timing: String(data.timing ?? 'TBD'),
          status: String(data.status ?? 'Estimated'),
          owner: String(data.owner ?? 'Unassigned'),
          position: draft.position,
        },
      }, {
        onSuccess: (created) => {
          campaignVersion.current += 1;
          const node: Node = {
            id: created.id,
            type: 'activity',
            position: created.position,
            data: {
              ...created,
              connectionSourceId: connectionMode?.sourceId,
              onConnectionAction: dispatchConnectionAction,
            } as unknown as Record<string, unknown>,
          };
          setNodes((current) => {
            const next = current.concat(node);
            latestMap.current = { nodes: next, edges };
            return next;
          });
          setSelectedElement({ type: 'node', id: created.id });
          setPendingActivity(null);
          queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaign.id) });
          queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
          resolve();
        },
        onError: reject,
      });
      return;
    }
    const committed: Node = {
      ...draft,
      data: { ...draft.data, ...updates, id: draft.id } as Record<string, unknown>,
    };
    const nextNodes = isNew
      ? [...nodes, committed]
      : nodes.map((node) => node.id === committed.id ? committed : node);
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    setNodes(nextNodes);
    localRevision.current += 1;
    latestMap.current = { nodes: nextNodes, edges };
    setSaveStatus('saving');
    enqueueSave(nextNodes, edges, {
      onSuccess: () => {
        if (isNew) setPendingActivity(null);
        resolve();
      },
      onError: (error) => {
        setNodes((current) => {
          const rolledBack = isNew
            ? current.filter((node) => node.id !== committed.id)
            : current.map((node) => node.id === committed.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    activityTypeId: draft.data.activityTypeId,
                    namingInput: draft.data.namingInput,
                    answers: draft.data.answers,
                    overrides: draft.data.overrides,
                    audience: draft.data.audience,
                    status: draft.data.status,
                    name: draft.data.name,
                    generatedName: draft.data.generatedName,
                    effectiveInheritance: draft.data.effectiveInheritance,
                  },
                }
              : node);
          latestMap.current = { nodes: rolledBack, edges };
          return rolledBack;
        });
        reject(error);
      },
    });
  }), [campaign.audience, campaign.id, campaign.region, connectionMode?.sourceId, createActivity, dispatchConnectionAction, edges, enqueueSave, nodes, pendingActivity, queryClient, selectedElement?.id]);

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

  const deleteSelectedEdge = () => {
    if (selectedElement?.type !== 'edge') return;
    const edgeId = selectedElement.id;
    setEdges((eds) => {
      const next = eds.filter((edge) => edge.id !== edgeId);
      if (next.length !== eds.length) triggerSave(nodes, next);
      return next;
    });
    setSelectedElement(null);
  };

  const selectedNode = selectedElement?.type === 'node'
    ? nodes.find(n => n.id === selectedElement.id) ?? (pendingActivity?.id === selectedElement.id ? pendingActivity : null)
    : null;
  const selectedEdge = selectedElement?.type === 'edge' ? edges.find(e => e.id === selectedElement.id) : null;

  return (
    <div className="flex h-full w-full">
      {/* Activity Library Sidebar */}
      <div className="w-44 sm:w-64 bg-card border-r border-border flex flex-col shrink-0 z-10">
        <div className="p-3 sm:p-4 border-b border-border bg-muted/20">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <LayoutGrid className="h-4 w-4 text-primary" />
            Activity Library
          </h3>
          <p className="text-xs text-muted-foreground mt-1">Tap Add or drag onto the map.</p>
        </div>
        <ScrollArea className="flex-1 p-3 sm:p-4">
          <div className="space-y-2 sm:space-y-3">
            {activityCatalog?.activityTypes.map(type => (
              <div 
                key={type.id}
                draggable
                onDragStart={(e) => onDragStart(e as unknown as DragEvent, type.id)}
                className="touch-manipulation rounded-md border border-border bg-background p-2 text-sm transition-all hover:border-primary/50 hover:shadow-sm active:cursor-grabbing sm:p-3"
              >
                <div className="truncate font-medium" title={type.displayName}>{type.displayName}</div>
                <div className="mt-1 hidden text-xs text-muted-foreground sm:block">Draft planning template</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-8 w-full px-2 text-xs"
                  data-testid={`button-add-activity-${type.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    addActivityAtPosition(type.id, positionForLibraryAdd());
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sm:hidden">Add</span>
                  <span className="hidden sm:inline">Add</span>
                </Button>
              </div>
            ))}
            {!activityCatalog && (
              <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 min-w-0 min-h-0 relative flex" ref={reactFlowWrapper}>
        <ReactFlow
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
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
          edgeTypes={edgeTypes}
          className="bg-slate-50/50"
        >
          <Background gap={24} size={2} color="hsl(var(--border))" />
          <Controls className="bg-card border-border shadow-sm" />
          
          <Panel position="top-left" className="m-4 flex max-w-[min(28rem,calc(100%-2rem))] flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={connectionMode ? 'default' : 'outline'}
                size="sm"
                className="bg-card"
                aria-pressed={Boolean(connectionMode)}
                data-testid="button-connect-activities"
                onClick={() => {
                  setSelectedElement(null);
                  setConnectionMode((current) => current ? null : { sourceId: null });
                }}
              >
                <Link2 className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">{connectionMode ? 'Cancel connection' : 'Connect activities'}</span>
                <span className="sm:hidden">{connectionMode ? 'Cancel' : 'Connect'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-card"
                data-testid="button-fit-view"
                onClick={() => fitView({ padding: 0.2, duration: 800 })}
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                Fit View
              </Button>
            </div>
            {connectionMode && (
              <div
                role="status"
                aria-live="polite"
                data-testid="status-connection-mode"
                className="rounded-md border border-primary/30 bg-card/95 px-3 py-2 text-xs shadow-sm"
              >
                {connectionMode.sourceId ? (
                  <>
                    <span className="font-medium text-primary">
                      {String(nodes.find((node) => node.id === connectionMode.sourceId)?.data.name || 'Activity')} selected.
                    </span>{' '}
                    Tap another activity or its <span className="font-medium">Connect here</span> button.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-primary">Connect mode.</span>{' '}
                    Tap an activity or its <span className="font-medium">Connect from here</span> button to choose the source.
                  </>
                )}
              </div>
            )}
          </Panel>

          <Panel position="bottom-right" className="m-4 max-w-[calc(100%-2rem)]">
            <div className="bg-card border border-border shadow-sm rounded-md px-3 py-1.5 flex flex-wrap items-center gap-2 text-sm">
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
          onSubmit={(setup: WebinarSetup, developmentSimulation) => {
            if (!webinarSetupDrop) return;
            setWebinarSetupError('');
            setWebinarSetupSaving(true);
            createActivity({
              id: campaign.id,
              data: {
                rowVersion: campaignVersion.current,
                activityTypeId: 'webinar',
                namingInput: 'Webinar',
                answers: {},
                overrides: {},
                audience: campaign.audience,
                region: campaign.region,
                timing: 'TBD',
                status: 'Estimated',
                owner: 'Unassigned',
                position: webinarSetupDrop.position,
                webinarSetup: setup,
                ...(developmentSimulation ? { developmentSimulation } : {}),
              },
            }, {
              onSuccess: (created) => {
                campaignVersion.current += 1;
                const node: Node = {
                  id: created.id,
                  type: 'activity',
                  position: created.position,
                  data: {
                    ...created,
                    connectionSourceId: connectionMode?.sourceId,
                    onConnectionAction: dispatchConnectionAction,
                  } as unknown as Record<string, unknown>,
                };
                setNodes((current) => {
                  const next = current.concat(node);
                  latestMap.current = { nodes: next, edges };
                  return next;
                });
                setWebinarSetupSaving(false);
                setWebinarSetupDrop(null);
                queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaign.id) });
                queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
                queryClient.invalidateQueries({ queryKey: getListWebinarsQueryKey(campaign.id) });
              },
              onError: (error) => {
                setWebinarSetupSaving(false);
                setWebinarSetupError(error instanceof Error ? error.message : 'Failed to save webinar setup. Correct the setup and try again.');
              },
            });
          }}
        />

        {/* Config Drawer */}
        {selectedElement && selectedElement.type === 'node' && selectedNode && (
          <ActivityConfigDrawer
            campaignId={campaign.id}
            node={selectedNode}
            updateNodeData={updateSelectedNodeData}
             saveCanonicalData={(updates) => saveCanonicalNode(updates, pendingActivity?.id === selectedNode.id)}
             isNew={pendingActivity?.id === selectedNode.id}
             onClose={() => {
               if (pendingActivity?.id === selectedNode.id) setPendingActivity(null);
               setSelectedElement(null);
             }}
            communications={delivery?.communications.filter(c => c.activityId === selectedNode.id) || []}
            tasks={delivery?.tasks.filter(t => t.activityId === selectedNode.id) || []}
          />
        )}

        {selectedElement && selectedElement.type === 'edge' && (
          <div className="w-80 bg-card border-l border-border h-full flex flex-col absolute right-0 top-0 shadow-xl animate-in slide-in-from-right-8 z-20">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
              <h3 className="font-semibold text-sm">Connection rule</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label="Close connection rule"
                data-testid="button-close-connection-rule"
                onClick={() => setSelectedElement(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              {selectedEdge && (
                <div className="space-y-4">
                  <div className="rounded-md border border-border bg-background p-3 text-xs">
                    <span className="mb-1 block font-medium text-muted-foreground">Activities</span>
                    <span className="font-medium">{String(nodes.find((node) => node.id === selectedEdge.source)?.data.name || selectedEdge.source.slice(0, 8))}</span>
                    <span className="mx-1 text-muted-foreground" aria-hidden="true">→</span>
                    <span className="font-medium">{String(nodes.find((node) => node.id === selectedEdge.target)?.data.name || selectedEdge.target.slice(0, 8))}</span>
                  </div>
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
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      data-testid={`button-delete-connection-${selectedEdge.id}`}
                      onClick={deleteSelectedEdge}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete connection
                    </Button>
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
    <div className="w-full min-h-64 h-[calc(100vh-12rem)] relative bg-muted/10 rounded-lg border border-border overflow-hidden">
      <ReactFlowProvider key={campaign.id}>
        <FlowCanvas campaign={campaign} />
      </ReactFlowProvider>
    </div>
  );
}
