'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { PieceDTO, PlanDTO, TableDTO } from '../api';
import {
  pathOf, placementBounds, uiContour, uiPieceExtent, viewForBounds, type UIPiece,
} from './frame';
import { snapPlacement, SNAP_THRESHOLD_CM } from './snap';
import Rulers, { rulerStep } from './Rulers';

/**
 * Canvas SVG façon Canva : le viewBox exprime les centimètres RÉELS
 * (indépendants du zoom et de la fenêtre). Repère écran transposé :
 * X = longueur de la table, Y = largeur du tissu (voir frame.ts).
 * Pan (fond), déplacement de pièces (poignées), zoom molette/boutons,
 * cadrage auto (pièces à l'ouverture, table via handle.fit), cm.
 */

export interface CanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Cadrer la table entière. */
  fit: () => void;
  /** Cadrer les pièces placées (repli : table si aucune pièce). */
  fitContent: () => void;
}

interface CuttingCanvasProps {
  plan: PlanDTO;
  table: TableDTO | null;
  pieces: PieceDTO[];
  placements: UIPiece[];
  selectedKeys: string[];
  violations: Map<string, string>;
  snapEnabled: boolean;
  dragPiece: PieceDTO | null;
  /** Vue proposition : déplacement de pièces désactivé (pan/zoom seuls). */
  readOnly?: boolean;
  onSelectionChange: (keys: string[], additive: boolean) => void;
  onPlacementsChange: (next: UIPiece[], commit: boolean) => void;
  onPlacementsCommit: (baseline: UIPiece[], final: UIPiece[]) => void;
  onDropPiece: (pieceId: number, x: number, y: number) => void;
  /** Ctrl+clic sur une pièce : duplique la pièce placée. */
  onDuplicate?: (key: string) => void;
}

interface ViewState { x: number; y: number; w: number }

const MIN_VIEW_CM = 60;
const FIT_PADDING_CM = 60;

const CuttingCanvas = forwardRef<CanvasHandle, CuttingCanvasProps>(
  function CuttingCanvas(props, ref) {
    const {
      plan, table, pieces, placements, selectedKeys, violations,
      snapEnabled, dragPiece, onSelectionChange, onPlacementsChange,
      onPlacementsCommit, onDropPiece, onDuplicate, readOnly = false,
    } = props;
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [view, setView] = useState<ViewState>({ x: -60, y: -60, w: 1200 });
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
    const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
    const drag = useRef<{
      mode: 'pan' | 'move' | null;
      startClient: { x: number; y: number };
      startView: ViewState;
      startWorld: { x: number; y: number };
      originals: UIPiece[];
      primaryKey: string | null;
      moved: boolean;
    } | null>(null);

    const tableLength = table?.longueurMaxCm ?? plan.matelas_length_cm;
    const tableWidth = table?.largeurCm ?? plan.usable_width_cm;
    const zone = useMemo(
      () => ({ x: 0, y: 0, width: plan.matelas_length_cm, height: plan.usable_width_cm }),
      [plan],
    );
    const pieceById = useMemo(
      () => new Map(pieces.map((piece) => [piece.id, piece])),
      [pieces],
    );
    const viewH = size.h > 0 ? view.w * (size.h / Math.max(size.w, 1)) : view.w;

    const clientToWorld = useCallback((clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return { x: 0, y: 0 };
      const height = view.w * (rect.height / rect.width);
      return {
        x: view.x + ((clientX - rect.left) * view.w) / rect.width,
        y: view.y + ((clientY - rect.top) * height) / rect.height,
      };
    }, [view]);

    const fit = useCallback(() => {
      if (!wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const scale = Math.min(
        rect.width / (tableLength + 2 * FIT_PADDING_CM),
        rect.height / (tableWidth + 2 * FIT_PADDING_CM),
      );
      const w = rect.width / scale;
      const h = rect.height / scale;
      setView({ x: tableLength / 2 - w / 2, y: tableWidth / 2 - h / 2, w });
    }, [tableLength, tableWidth]);

    const extentOf = useCallback((item: { pieceId: number; rotation: number }) => {
      const definition = pieceById.get(item.pieceId);
      return definition ? uiPieceExtent(definition, item.rotation) : { width: 0, height: 0 };
    }, [pieceById]);

    /** Cadrage automatique sur les patrons (repli : table si vide). */
    const fitContent = useCallback(() => {
      if (placements.length === 0) { fit(); return; }
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const bounds = placementBounds(placements, extentOf);
      if (bounds) setView(viewForBounds(bounds, rect, FIT_PADDING_CM));
    }, [placements, extentOf, fit]);

    useLayoutEffect(() => {
      const element = wrapperRef.current;
      if (!element) return;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0].contentRect;
        setSize({ w: rect.width, h: rect.height });
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      // Recadrage initial sur les pièces (jamais ensuite : positions stables).
      if (size.w > 0 && size.h > 0) fitContent();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size.w, size.h]);

    const zoomAt = useCallback((factor: number, anchor?: { x: number; y: number }) => {
      setView((current) => {
        const rect = svgRef.current?.getBoundingClientRect();
        const height = current.w * (rect ? rect.height / rect.width : 0.6);
        const point = anchor ?? {
          x: current.x + current.w / 2,
          y: current.y + height / 2,
        };
        const nextW = Math.min(4000, Math.max(MIN_VIEW_CM, current.w * factor));
        const ratio = nextW / current.w;
        return {
          w: nextW,
          x: point.x - (point.x - current.x) * ratio,
          y: point.y - (point.y - current.y) * ratio,
        };
      });
    }, []);

    useImperativeHandle(ref, () => ({
      zoomIn: () => zoomAt(1 / 1.25),
      zoomOut: () => zoomAt(1.25),
      fit,
      fitContent,
    }), [zoomAt, fit, fitContent]);

    const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
      const target = event.target as Element;
      const pieceGroup = target.closest('[data-piece]');
      const world = clientToWorld(event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (pieceGroup && !dragPiece && !readOnly) {
        const key = pieceGroup.getAttribute('data-piece') ?? '';
        // Ctrl+clic : duplication immédiate de la pièce placée.
        if ((event.ctrlKey || event.metaKey) && onDuplicate) {
          event.preventDefault();
          onDuplicate(key);
          return;
        }
        const additive = event.shiftKey;
        onSelectionChange([key], additive);
        const originals = (additive
          ? placements.filter((item) => selectedKeys.includes(item.key) || item.key === key)
          : placements.filter((item) => item.key === key)
        ).map((item) => ({ ...item }));
        drag.current = {
          mode: 'move',
          startClient: { x: event.clientX, y: event.clientY },
          startView: view,
          startWorld: world,
          originals,
          primaryKey: key,
          moved: false,
        };
      } else {
        if (!event.shiftKey) onSelectionChange([], false);
        drag.current = {
          mode: 'pan',
          startClient: { x: event.clientX, y: event.clientY },
          startView: view,
          startWorld: world,
          originals: [],
          primaryKey: null,
          moved: false,
        };
      }
    };

    const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
      const world = clientToWorld(event.clientX, event.clientY);
      setCursor(world);
      const state = drag.current;
      if (dragPiece) {
        const extent = uiPieceExtent(dragPiece, 0);
        setGhost({ x: world.x - extent.height / 2, y: world.y - extent.width / 2 });
        return;
      }
      if (!state?.mode) return;
      if (state.mode === 'pan') {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const height = state.startView.w * (rect.height / rect.width);
        setView({
          w: state.startView.w,
          x: state.startView.x - ((event.clientX - state.startClient.x) * state.startView.w) / rect.width,
          y: state.startView.y - ((event.clientY - state.startClient.y) * height) / rect.height,
        });
        return;
      }
      // Déplacement de pièces : delta en cm réels depuis le début du geste.
      const deltaX = world.x - state.startWorld.x;
      const deltaY = world.y - state.startWorld.y;
      if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) state.moved = true;
      const primary = state.originals.find((item) => item.key === state.primaryKey);
      let snappedDeltaX = deltaX;
      let snappedDeltaY = deltaY;
      if (snapEnabled && primary) {
        const piece = pieceById.get(primary.pieceId);
        if (piece) {
          const moved = { ...primary, x: primary.x + deltaX, y: primary.y + deltaY };
          const snapped = snapPlacement(moved, {
            zone,
            gapCm: plan.gap_cm,
            others: placements.filter((item) => !state.originals.some((origin) => origin.key === item.key)),
            extent: extentOf,
          });
          snappedDeltaX = snapped.x - primary.x;
          snappedDeltaY = snapped.y - primary.y;
        }
      }
      const next = placements.map((item) => {
        const origin = state.originals.find((candidate) => candidate.key === item.key);
        if (!origin) return item;
        return { ...item, x: origin.x + snappedDeltaX, y: origin.y + snappedDeltaY };
      });
      onPlacementsChange(next, false);
    };

    const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
      const state = drag.current;
      drag.current = null;
      if (dragPiece) {
        const world = clientToWorld(event.clientX, event.clientY);
        const extent = uiPieceExtent(dragPiece, 0);
        onDropPiece(dragPiece.id, world.x - extent.height / 2, world.y - extent.width / 2);
        setGhost(null);
        return;
      }
      if (state?.mode === 'move' && state.moved) {
        const baseline = placements.map((item) => (
          state.originals.find((origin) => origin.key === item.key) ?? item
        ));
        onPlacementsCommit(baseline, placements);
      }
    };

    const contours = useMemo(() => placements.map((placement) => {
      const piece = pieceById.get(placement.pieceId);
      if (!piece) return '';
      return pathOf(uiContour(piece.points, placement.rotation, placement.x, placement.y));
    }), [placements, pieceById]);

    const handleSize = Math.max(view.w / 140, 1.2);
    const fontScale = Math.max(view.w / 150, 5);

    return (
      <Box
        ref={wrapperRef}
        sx={{
          position: 'relative', flex: 1, minWidth: 0, bgcolor: '#f1f5f9',
          borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: 'divider',
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${view.x} ${view.y} ${view.w} ${viewH}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onWheel={(event) => {
            event.preventDefault();
            const anchor = clientToWorld(event.clientX, event.clientY);
            zoomAt(event.deltaY > 0 ? 1.12 : 1 / 1.12, anchor);
          }}
          style={{ cursor: drag.current?.mode === 'pan' ? 'grabbing' : 'default', touchAction: 'none', display: 'block' }}
        >
          <defs>
            <pattern id="grid-minor" width={10} height={10} patternUnits="userSpaceOnUse">
              <path d={`M 10 0 L 0 0 0 10`} fill="none" stroke="#e2e8f0" strokeWidth={Math.max(view.w / 3000, 0.05)} />
            </pattern>
            <pattern id="grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
              <rect width={100} height={100} fill="url(#grid-minor)" />
              <path d={`M 100 0 L 0 0 0 100`} fill="none" stroke="#cbd5e1" strokeWidth={Math.max(view.w / 2500, 0.08)} />
            </pattern>
          </defs>

          <rect x={0} y={0} width={tableLength} height={tableWidth} fill="#ffffff" stroke="#94a3b8" strokeWidth={Math.max(view.w / 800, 0.2)} />
          <rect x={0} y={0} width={zone.width} height={zone.height} fill="#eff6ff" fillOpacity={0.6} stroke="#3b82f6" strokeDasharray={`${view.w / 120} ${view.w / 240}`} strokeWidth={Math.max(view.w / 900, 0.15)} />

          <rect x={0} y={0} width={tableLength} height={tableWidth} fill="url(#grid-major)" pointerEvents="none" />

          <Rulers
            tableLength={tableLength} tableWidth={tableWidth}
            step={rulerStep(tableLength)} fontScale={fontScale}
            strokeWidth={Math.max(view.w / 2000, 0.1)}
          />

          {placements.map((placement, index) => {
            const selected = selectedKeys.includes(placement.key);
            const invalid = violations.has(placement.key);
            const stroke = invalid ? '#dc2626' : selected ? '#7c3aed' : '#334155';
            return (
              <g key={placement.key} data-piece={placement.key}>
                <path
                  d={contours[index]}
                  fill={invalid ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.10)'}
                  stroke={stroke}
                  strokeWidth={(invalid ? 2.2 : selected ? 2 : 1) * Math.max(view.w / 1200, 0.3)}
                  style={{ cursor: 'move' }}
                />
                {selected && (() => {
                  const piece = pieceById.get(placement.pieceId);
                  if (!piece) return null;
                  const extent = uiPieceExtent(piece, placement.rotation);
                  const corners = [
                    { x: placement.x, y: placement.y },
                    { x: placement.x + extent.width, y: placement.y },
                    { x: placement.x + extent.width, y: placement.y + extent.height },
                    { x: placement.x, y: placement.y + extent.height },
                  ];
                  return corners.map((corner, cornerIndex) => (
                    <rect
                      key={`handle-${cornerIndex}`}
                      x={corner.x - handleSize / 2}
                      y={corner.y - handleSize / 2}
                      width={handleSize}
                      height={handleSize}
                      fill="#7c3aed"
                      stroke="#ffffff"
                      strokeWidth={handleSize / 6}
                      pointerEvents="none"
                    />
                  ));
                })()}
              </g>
            );
          })}

          {ghost && dragPiece && (() => {
            const extent = uiPieceExtent(dragPiece, 0);
            return (
              <rect
                x={ghost.x} y={ghost.y} width={extent.height} height={extent.width}
                fill="rgba(124,58,237,0.18)" stroke="#7c3aed"
                strokeDasharray={`${handleSize} ${handleSize}`} pointerEvents="none"
              />
            );
          })()}

          <text x={tableLength / 2} y={tableWidth + fontScale * 2.4} fontSize={fontScale} textAnchor="middle" fill="#64748b" pointerEvents="none">
            {table?.nom ?? 'Table'} — {Math.round(tableLength)} × {Math.round(tableWidth)} cm
          </text>
        </svg>

        <Box sx={{
          position: 'absolute', left: 12, bottom: 10, bgcolor: 'rgba(255,255,255,0.92)',
          borderRadius: 1, px: 1.2, py: 0.4, fontSize: 12, fontFamily: 'monospace',
          border: '1px solid', borderColor: 'divider', pointerEvents: 'none',
        }}>
          {cursor ? `X : ${cursor.x.toFixed(1)} cm   Y : ${cursor.y.toFixed(1)} cm` : 'X : —   Y : —'}
          {snapEnabled ? `   (accrochage ±${SNAP_THRESHOLD_CM} cm)` : '   (libre)'}
        </Box>
      </Box>
    );
  },
);

export default CuttingCanvas;
