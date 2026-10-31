'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { atelierAction, loadWorkspace } from './api';
import type {
  PieceDTO, PlanDTO, RevisionDTO, RollDTO, TableDTO,
  WorkspaceData, VerifyResult,
} from './api';
import PanelOptimize from './PanelOptimize';
import PanelPieces from './PanelPieces';
import PanelProperties from './PanelProperties';
import PanelMetrics from './PanelMetrics';
import PatternDemoPreview from './PatternDemoPreview';
import TopBar from './TopBar';
import WorkflowSteps from './WorkflowSteps';
import CuttingCanvas from './canvas/CuttingCanvas';
import type { CanvasHandle } from './canvas/CuttingCanvas';
import { placementToServer, placementToUi, uiZone, type UIPiece } from './canvas/frame';
import { usePlanHistory } from './canvas/usePlanHistory';
import { useLiveValidation } from './canvas/useLiveValidation';
import { useKeyboardShortcuts } from './canvas/useKeyboardShortcuts';
import { usePlanOptimizer } from './usePlanOptimizer';
import { usePlanIo } from './usePlanIo';
import { usePlanValidation } from './usePlanValidation';
import { usePlacementSummary } from './usePlacementSummary';

/**
 * Orchestrateur de l'atelier Coupe : workflow en 10 étapes, sélection
 * rouleau/patron, création et ouverture de plans, interactions canvas,
 * indicateur de modifications non sauvegardées (avec garde de sortie),
 * sauvegarde explicite — le serveur revalide tout.
 */

interface Toast { message: string; severity: 'success' | 'error' | 'info' | 'warning' }

const DIRTY_CONFIRM = 'Ce plan contient des modifications non enregistrées. Continuer et perdre ces modifications ?';

/** Rail vertical repliable (dock façon Illustrator) entre le canvas et les panneaux. */
function DockRail({
  side, open, onToggle,
}: {
  side: 'left' | 'right';
  open: boolean;
  onToggle: () => void;
}) {
  const Chevron = side === 'left'
    ? (open ? ChevronLeftIcon : ChevronRightIcon)
    : (open ? ChevronRightIcon : ChevronLeftIcon);
  return (
    <Tooltip title={open ? `Masquer le panneau ${side === 'left' ? 'des pièces' : 'propriétés'}` : `Afficher le panneau ${side === 'left' ? 'des pièces' : 'propriétés'}`}>
      <Box
        sx={{
          width: 22, flexShrink: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper',
          borderRight: side === 'left' ? '1px solid' : undefined,
          borderLeft: side === 'right' ? '1px solid' : undefined,
          borderColor: 'divider',
        }}
      >
        <IconButton size="small" onClick={onToggle} aria-label={open ? 'Replier le panneau' : 'Déplier le panneau'}
          sx={{ '& svg': { fontSize: 18 }, '&:hover': { bgcolor: 'rgba(15,122,77,0.08)' } }}
        >
          <Chevron />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

export default function Workspace() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [rollId, setRollId] = useState('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [revisionId, setRevisionId] = useState('');
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [tableId, setTableId] = useState('');
  const [matelas, setMatelas] = useState('500');
  const [layers, setLayers] = useState('1');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [dragPiece, setDragPiece] = useState<PieceDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const history = usePlanHistory<UIPiece[]>([]);
  const savedSnapshot = useRef<string>('');

  useEffect(() => {
    loadWorkspace().then((data) => {
      setWorkspace(data);
      const firstTable = data.tables.find((table) => table.nom === 'Table 1');
      if (firstTable) setTableId(String(firstTable.id));
    }).catch((error: Error) => setToast({ message: error.message, severity: 'error' }));
  }, []);

  const revision: RevisionDTO | null = useMemo(
    () => workspace?.revisions.find(
      (item) => item.id === Number(revisionId) && item.status === 'valide',
    ) ?? null,
    [workspace, revisionId],
  );
  const roll: RollDTO | null = useMemo(
    () => workspace?.rolls.find((item) => item.id === Number(rollId)) ?? null,
    [workspace, rollId],
  );
  const table: TableDTO | null = useMemo(
    () => workspace?.tables.find((item) => item.id === Number(tableId)) ?? null,
    [workspace, tableId],
  );

  const optimizer = usePlanOptimizer({
    plan, revision, roll, history, canvasRef, setToast,
    reloadPlan: async (planId: number) => {
      const loaded = await atelierAction<PlanDTO>('plan.get', { planId });
      refreshPlan(loaded);
    },
    reloadPlans: async () => {
      const data = await loadWorkspace();
      setWorkspace(data);
    },
  });
  const {
    optimizing, accepting, optimize, proposalPlacements, viewMode,
    currentMetrics, currentWasteKg, autofill, applyingTarget,
    runOptimize, runAutofill, applyTargetMatelas, acceptProposal, rejectProposal,
  } = optimizer;

  const refreshPlan = useCallback((next: PlanDTO) => {
    setPlan(next);
    const ui = next.placements.map((placement, index) => placementToUi(placement, index));
    history.reset(ui);
    savedSnapshot.current = JSON.stringify(ui.map(placementToServer));
    setSelectedKeys([]);
    optimizer.resetProposal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modifications non enregistrées : l'état courant diffère du dernier
  // état enregistré (comparaison déterministe des placements serveur).
  const isDirty = useMemo(() => (
    plan !== null
    && JSON.stringify(history.state.map(placementToServer)) !== savedSnapshot.current
  ), [plan, history.state]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const createPlan = useCallback(async () => {
    if (!revision || !roll || !table) return;
    if (isDirty && !window.confirm(DIRTY_CONFIRM)) return;
    try {
      const created = await atelierAction<PlanDTO>('plan.create', {
        revisionId: revision.id, rollId: roll.id, tableId: table.id,
        layers: Number(layers), gapCm: 1, matelasLengthCm: Number(matelas), qty: 1,
      });
      refreshPlan(created);
      setToast({ message: `Plan #${created.id} créé sur ${table.nom}.`, severity: 'success' });
      requestAnimationFrame(() => canvasRef.current?.fitContent());
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    }
  }, [revision, roll, table, layers, matelas, refreshPlan, isDirty]);

  const openPlan = useCallback(async (planId: number) => {
    if (isDirty && !window.confirm(DIRTY_CONFIRM)) return;
    try {
      const loaded = await atelierAction<PlanDTO>('plan.get', { planId });
      try {
        const input = JSON.parse(loaded.input_json ?? '{}') as { revisionId?: unknown };
        if (typeof input.revisionId === 'number' && input.revisionId > 0) {
          setRevisionId(String(input.revisionId));
        }
      } catch { /* plan sans input_json : pas de sélection auto */ }
      refreshPlan(loaded);
      requestAnimationFrame(() => canvasRef.current?.fitContent());
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    }
  }, [refreshPlan, isDirty]);

  const zone = plan ? uiZone(plan) : null;
  const displayedPlacements = viewMode === 'proposal' ? proposalPlacements : history.state;
  const displayedViolations = useLiveValidation(
    displayedPlacements,
    revision?.pieces ?? [],
    zone ?? { x: 0, y: 0, width: 1, height: 1 },
    plan?.gap_cm ?? 1,
  );

  const { summary, sizeLabel, placedCounts } = usePlacementSummary(
    workspace, revision, history.state, displayedViolations, viewMode,
  );

  const { handleTransfer, handleRemetrics } = usePlanIo(refreshPlan, (toast) => setToast(toast));
  const { validating: validatingPlan, validatePlan: handleValidatePlan } =
    usePlanValidation({ plan, canValidate: workspace?.canValidatePlan === true, dirty: isDirty, refreshPlan, setWorkspace, setToast: (toast) => setToast(toast) });
  const changePlacements = useCallback((next: UIPiece[], commit: boolean) => {
    history.set(next, commit);
  }, [history]);

  const commitPlacements = useCallback((baseline: UIPiece[], final: UIPiece[]) => {
    history.commit(baseline, final);
  }, [history]);

  const dropPiece = useCallback((pieceId: number, x: number, y: number) => {
    const piece = revision?.pieces.find((item) => item.id === pieceId);
    if (!piece || !zone || !plan) return;
    const placedCount = history.state.filter((item) => item.pieceId === pieceId).length;
    if (placedCount >= piece.qty) {
      setToast({ message: `Quantité requise atteinte pour « ${piece.label} » (×${piece.qty}).`, severity: 'warning' });
      return;
    }
    const offsetX = Math.min(history.state.length * 80, Math.max(0, zone.width - piece.heightCm - 5));
    const targetX = x === 5 && y === 5 ? 5 + offsetX : x;
    const clampedX = Math.max(0, Math.min(targetX, zone.width - piece.heightCm));
    const clampedY = Math.max(0, Math.min(y, zone.height - piece.widthCm));
    const next = [...history.state, {
      key: `new-${pieceId}-${Date.now()}`, pieceId, code: piece.code, label: piece.label,
      x: clampedX, y: clampedY, rotation: 0,
      points: piece.points.map((point) => ({ x: point.y, y: point.x })),
    }];
    history.set(next, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, zone, plan, history]);

  const deleteSelection = useCallback((keys: string[]) => {
    if (plan?.status === 'valide' || keys.length === 0) return;
    history.set(history.state.filter((item) => !keys.includes(item.key)), true);
  }, [history, plan]);

  const duplicatePlacement = useCallback((key: string) => {
    const source = history.state.find((item) => item.key === key);
    const piece = source ? revision?.pieces.find((item) => item.id === source.pieceId) : null;
    if (!source || !piece || !zone) return;
    // Duplication libre (Ctrl+clic ou bouton) : le chef de coupe remplit
    // le matelas à sa main ; le serveur revalide tout à l'enregistrement.
    const clone = { ...source, key: `dup-${source.pieceId}-${Date.now()}`, x: source.x + 5, y: source.y + 5 };
    history.set([...history.state, clone], true);
  }, [history, revision, zone]);

  const movePlacement = useCallback((key: string, x: number, y: number, commit: boolean) => {
    history.set(history.state.map((item) => (item.key === key ? { ...item, x, y } : item)), commit);
  }, [history]);

  const rotatePlacement = useCallback((key: string, rotation: number, commit: boolean) => {
    history.set(history.state.map((item) => (item.key === key ? { ...item, rotation } : item)), commit);
  }, [history]);

  const nudgeSelection = useCallback((keys: string[], deltaX: number, deltaY: number) => {
    history.set(history.state.map((item) => (keys.includes(item.key)
      ? { ...item, x: item.x + deltaX, y: item.y + deltaY }
      : item)), true);
  }, [history]);

  const savePlan = useCallback(async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const saved = await atelierAction<PlanDTO>('plan.save', {
        planId: plan.id,
        placements: history.state.map((item) => placementToServer(item)),
      });
      refreshPlan(saved);
      setToast({ message: `Plan #${saved.id} enregistré (${saved.total_pieces} pièces, ${saved.efficiency.toFixed(1)} %).`, severity: 'success' });
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [plan, history.state, refreshPlan]);

  const changeTable = useCallback(async (nextTableId: number) => {
    setTableId(String(nextTableId));
    if (!plan || !revision || !roll) return;
    if (isDirty && !window.confirm(DIRTY_CONFIRM)) return;
    const nextTable = workspace?.tables.find((item) => item.id === nextTableId);
    if (!nextTable) return;
    try {
      const created = await atelierAction<PlanDTO>('plan.create', {
        revisionId: revision.id, rollId: roll.id, tableId: nextTableId,
        layers: plan.layers, gapCm: plan.gap_cm,
        matelasLengthCm: Math.min(plan.matelas_length_cm, nextTable.longueurMaxCm), qty: 1,
      });
      const carried = history.state.map((item) => placementToServer(item));
      const verified = await atelierAction<VerifyResult>('plan.verify', { planId: created.id, placements: carried }).catch(() => null);
      refreshPlan(created);
      requestAnimationFrame(() => canvasRef.current?.fitContent());
      if (verified && !verified.ok) {
        setToast({ message: `Table changée : ${verified.violations.length} pièce(s) invalide(s) à repositionner.`, severity: 'warning' });
      } else {
        setToast({ message: `Plan recréé sur ${nextTable.nom}.`, severity: 'success' });
      }
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    }
  }, [plan, revision, roll, workspace, history.state, refreshPlan, isDirty]);

  const canEdit = plan !== null && plan.status !== 'valide' && viewMode === 'current';
  useKeyboardShortcuts({
    allowedRotationsOf: (key) => {
      const placement = history.state.find((item) => item.key === key);
      const piece = placement
        ? revision?.pieces.find((item) => item.id === placement.pieceId) : null;
      if (!piece) return [];
      return piece.allowedRotations.map((angle) => (
        angle === 90 ? 270 : angle === 270 ? 90 : angle));
    },
    currentRotationOf: (key) => history.state.find((item) => item.key === key)?.rotation ?? null,
    selectedKeys, canEdit,
    onUndo: history.undo, onRedo: history.redo,
    onDelete: deleteSelection, onDuplicate: duplicatePlacement,
    onNudge: nudgeSelection,
    onRotate: (key, rotation) => rotatePlacement(key, rotation, true),
    onClearSelection: () => setSelectedKeys([]),
  });

  if (!workspace) {
    return <Box sx={{ p: 4 }}>Chargement de l’atelier…</Box>;
  }
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <TopBar
        plan={plan} revision={revision} roll={roll} tables={workspace.tables} table={table}
        hasUnsaved={isDirty} canUndo={history.canUndo} canRedo={history.canRedo} saving={saving}
        optimizing={optimizing}
        rolls={workspace.rolls}
        revisions={workspace.revisions.filter((item) => item.status === 'valide')}
        plans={workspace.plans}
        rollId={rollId} revisionId={revisionId}
        matelas={matelas} layers={layers}
        onRollChange={setRollId} onRevisionChange={setRevisionId}
        onMatelasChange={setMatelas} onLayersChange={setLayers}
        onCreate={() => { void createPlan(); }} onOpen={(planId) => { void openPlan(planId); }}
        onTableChange={changeTable} onUndo={history.undo} onRedo={history.redo}
        onZoomIn={() => canvasRef.current?.zoomIn()} onZoomOut={() => canvasRef.current?.zoomOut()}
        onFit={() => canvasRef.current?.fitContent()}
        onFitTable={() => canvasRef.current?.fit()}
        onSave={savePlan} onOptimize={runOptimize}
        autofilling={optimizing} onAutofill={() => { void runAutofill(); }}
      >
        <WorkflowSteps
          compact
          rollSelected={roll !== null} productSelected={revision !== null}
          revisionValide={revision !== null} planCreated={plan !== null}
          hasPlacements={history.state.length > 0}
          noViolations={displayedViolations.size === 0}
          saved={!isDirty} planValide={plan?.status === 'valide'}
          transferred={plan?.lot_id != null} dirty={isDirty}
        />
        <PatternDemoPreview products={workspace.catalogue} inline />
      </TopBar>
      {optimize && (
        <PanelOptimize
          proposal={optimize}
          currentMetrics={currentMetrics}
          currentWasteKg={currentWasteKg}
          sameCoverage={(() => {
            const current = history.state.map((item) => item.pieceId).sort((a, b) => a - b);
            const proposed = optimize.placements.map((item) => item.pieceId).sort((a, b) => a - b);
            return current.length === proposed.length
              && current.every((pieceId, index) => pieceId === proposed[index]);
          })()}
          accepting={accepting}
          onAccept={() => { void acceptProposal(); }}
          onReject={rejectProposal}
        />
      )}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {leftOpen && (
          <PanelPieces
            revision={revision} placedCounts={placedCounts}
            onDragPiece={setDragPiece} onAddPiece={(piece) => dropPiece(piece.id, 5, 5)}
          />
        )}
        <DockRail side="left" open={leftOpen} onToggle={() => setLeftOpen((value) => !value)} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0.5, minWidth: 0 }}
          onDragOver={(event) => { if (dragPiece) event.preventDefault(); }}
          onDrop={(event) => {
            if (!dragPiece || !plan) return;
            event.preventDefault();
            const pieceRect = document.querySelector('svg')?.getBoundingClientRect();
            if (!pieceRect) return;
            const scaleX = (plan.zone.height ? plan.matelas_length_cm : 0) / pieceRect.width;
            const scaleY = (plan.zone.width ? plan.usable_width_cm : 0) / pieceRect.height;
            void dropPiece(dragPiece.id,
              (event.clientX - pieceRect.left) * scaleX - 0,
              (event.clientY - pieceRect.top) * scaleY - 0);
          }}
        >
          {plan ? (
            <CuttingCanvas
              ref={canvasRef} plan={plan} table={table} pieces={revision?.pieces ?? []}
              placements={displayedPlacements} selectedKeys={selectedKeys}
              violations={displayedViolations} readOnly={viewMode === 'proposal'}
              snapEnabled dragPiece={dragPiece}
              onSelectionChange={(keys, additive) => setSelectedKeys((current) => {
                if (!additive) return keys;
                return keys.length > 0 && !current.includes(keys[0]) ? [...current, keys[0]] : current;
              })}
              onPlacementsChange={changePlacements}
              onPlacementsCommit={commitPlacements}
              onDropPiece={dropPiece}
              onDuplicate={duplicatePlacement}
            />
          ) : (
            <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
              Sélectionnez un rouleau, un patron validé, puis créez le plan.
            </Box>
          )}
        </Box>
        <DockRail side="right" open={rightOpen} onToggle={() => setRightOpen((value) => !value)} />
        {rightOpen && (
          <Box sx={{ width: 280, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <PanelProperties
              revision={revision} selection={history.state.filter((item) => selectedKeys.includes(item.key))}
              violations={displayedViolations} planStatus={plan?.status ?? 'proposition'}
              efficiency={plan?.efficiency ?? 0}
              onMove={movePlacement} onRotate={rotatePlacement}
              onDelete={(key) => deleteSelection([key])} onDuplicate={duplicatePlacement}
            />
            <PanelMetrics
              metrics={currentMetrics} wasteKgValue={currentWasteKg}
              invalidCount={viewMode === 'current' ? displayedViolations.size : 0} summary={summary} plan={plan}
              modelLabel={`Modèle : ${revision?.modelName ?? '—'} · Taille : ${sizeLabel}`}
              placementCount={history.state.length} canValidatePlan={workspace.canValidatePlan}
              planDirty={isDirty} validatingPlan={validatingPlan} onValidatePlan={handleValidatePlan}
              onTransfer={handleTransfer} onRemetrics={handleRemetrics}
              autofill={autofill} applyingTarget={applyingTarget}
              onApplyTargetMatelas={(target) => { void applyTargetMatelas(target); }}
              onOpenPlan={(planId) => { void openPlan(planId); }}
              rollLabel={roll?.code ?? null}
            />
          </Box>
        )}
      </Box>
      <Snackbar open={toast !== null} autoHideDuration={6000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity ?? 'info'} onClose={() => setToast(null)} sx={{ width: '100%' }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
