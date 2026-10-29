'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import type { CutTransferResult, OptimizeResult, PlanDTO, RemetricsResult } from './api';
import type { PlacementSummary } from '@/lib/cutting/metrics';
import {
  checkMarkerCoherence, maxPersistedLengthCm, wastePctOf,
} from '@/lib/cutting/metrics';
import TransferDialog, { type TransferRow } from './TransferDialog';

/**
 * Indicateurs automatiques du placement (étape 7) : calculés par le
 * système à partir des contours réels et mis à jour à chaque geste —
 * aucun champ de saisie manuelle. Distinction explicite entre les
 * valeurs provisoires (calcul client sur le placement courant) et les
 * valeurs enregistrées (recalculées par le serveur à la sauvegarde).
 * Une pièce placée sur le canvas est un placement VIRTUEL : ce n'est
 * jamais une pièce physiquement coupée.
 * Étape 10 : avertissement de cohérence (longueur enregistrée vs
 * recalculée des contours persistés) et recalcul explicite, après
 * confirmation, pour les plans brouillons uniquement.
 */

interface PanelMetricsProps {
  metrics: OptimizeResult['metrics'] | null;
  wasteKgValue: number | null;
  invalidCount: number;
  summary: PlacementSummary | null;
  plan: PlanDTO | null;
  modelLabel: string;
  /** Occurrences actuellement sur le canvas (toutes pièces). */
  placementCount: number;
  canValidatePlan: boolean;
  planDirty: boolean;
  validatingPlan: boolean;
  onValidatePlan: () => void;
  /** Exécute le transfert (contrôlé par Workspace : API + rechargement). */
  onTransfer: (input: {
    planId: number;
    cutPieces: Array<{ pieceId: number; qty: number }>;
    confirmCut: true;
  }) => Promise<CutTransferResult>;
  /** Recalcul explicite des métriques (serveur, plan brouillon). */
  onRemetrics: (planId: number) => Promise<RemetricsResult>;
}

const FMT_AREA = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(2)} m²`;

export default function PanelMetrics(props: PanelMetricsProps) {
  const {
    metrics, wasteKgValue, invalidCount, summary, plan, modelLabel,
    placementCount, canValidatePlan, planDirty, validatingPlan, onValidatePlan,
    onTransfer, onRemetrics,
  } = props;
  const hasPlacement = metrics !== null && metrics.placedCount > 0;
  const wastePct = metrics ? wastePctOf(metrics) : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [remetricsPreview, setRemetricsPreview] = useState(false);
  const [remetricsBusy, setRemetricsBusy] = useState(false);
  // Cohérence des métriques enregistrées : longueur persistée comparée
  // à la longueur recalculée depuis les contours persistés (tolérance
  // explicite de 1 cm). Jamais une écriture automatique.
  const recalculatedLength = plan ? maxPersistedLengthCm(plan.placements) : null;
  const coherence = plan && recalculatedLength !== null
    ? checkMarkerCoherence(plan.marker_length_cm, recalculatedLength)
    : null;
  const staleDraft = plan?.status === 'proposition' && coherence?.stale === true;
  const confirmRemetrics = async () => {
    if (!plan) return;
    setRemetricsBusy(true);
    try {
      await onRemetrics(plan.id);
      setRemetricsPreview(false);
    } finally {
      setRemetricsBusy(false);
    }
  };
  const canTransfer = plan !== null
    && plan.status === 'valide'
    && plan.lot_id === null
    && summary !== null
    && summary.readyForTransfer
    && invalidCount === 0;
  const transferRows: TransferRow[] = (summary?.rows ?? [])
    .filter((row) => row.placed > 0)
    .map((row) => ({
      pieceId: row.pieceId, label: row.label, placed: row.placed, expected: row.expected,
    }));
  return (
    <Box sx={{
      width: 280, flexShrink: 0, bgcolor: 'background.paper',
      borderLeft: '1px solid', borderColor: 'divider',
      p: 2, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <Typography variant="subtitle2">Rendement du placement</Typography>
      <Typography variant="caption" color="text.secondary">
        Calculé automatiquement (longueur réellement occupée) — modifiable nulle part.
      </Typography>
      {!hasPlacement && placementCount > 0 && (
        <Typography variant="body2" color="text.secondary">
          Sélectionnez le patron du plan pour afficher les indicateurs provisoires.
        </Typography>
      )}
      {!hasPlacement && placementCount === 0 && (
        <Typography variant="body2" color="text.secondary">
          Aucune pièce placée : pas d’indicateur définitif.
        </Typography>
      )}
      {hasPlacement && metrics && (
        <>
          {invalidCount > 0 && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              {invalidCount} pièce(s) invalide(s) : indicateurs provisoires non exploitables
              pour une décision de coupe.
            </Alert>
          )}
          <Row label="Longueur occupée" value={`${metrics.consumedLengthCm.toFixed(1)} cm`} />
          <Row label="Surface consommée (largeur × longueur)" value={FMT_AREA(metrics.consumedAreaM2)} />
          <Row label="Surface des pièces (aires exactes)" value={FMT_AREA(metrics.piecesAreaM2)} />
          <Row label="Chutes géométriques" value={FMT_AREA(metrics.wasteAreaM2)} />
          <Row label="Taux d’utilisation (géométrique)" value={`${metrics.utilizationPct.toFixed(1)} %`} />
          <Row label="Taux de perte géométrique estimée" value={`${wastePct?.toFixed(1) ?? '—'} %`} />
          <Row
            label="Pertes en poids (chutes × grammage)"
            value={wasteKgValue === null ? 'Estimation en kg indisponible' : `${wasteKgValue.toFixed(2)} kg`}
          />
          <Typography variant="caption" color="text.secondary">
            Base : une couche de coupe, largeur utile {metrics.usableWidthCm.toFixed(0)} cm.
            Taux géométrique ≠ rendement industriel réel.
          </Typography>
        </>
      )}
      <Divider />
      <Typography variant="subtitle2">Plan enregistré (autorité serveur)</Typography>
      {plan ? (
        <>
          <Row label="État" value={plan.status === 'valide' ? 'validé (immuable)' : 'brouillon (proposition)'} />
          <Row label="Pièces enregistrées" value={String(plan.total_pieces)} />
          <Row label="Longueur occupée" value={`${plan.marker_length_cm.toFixed(1)} cm`} />
          <Row label="Surface des pièces" value={FMT_AREA(plan.placed_area_m2)} />
          <Row label="Efficacité (surface du matelas)" value={`${plan.efficiency.toFixed(1)} %`} />
          <Row label="Chutes (surface du matelas)" value={FMT_AREA(plan.waste_area_m2)} />
          <Typography variant="caption" color="text.secondary">
            Recalculé par le serveur à chaque enregistrement — base matelas
            {plan.matelas_length_cm.toFixed(0)} cm × {plan.usable_width_cm.toFixed(0)} cm.
          </Typography>
          {coherence?.stale && recalculatedLength !== null && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              Longueur enregistrée {plan.marker_length_cm.toFixed(1)} cm ≠ longueur
              recalculée des contours ({recalculatedLength.toFixed(1)} cm,
              écart {coherence.deltaCm.toFixed(1)} cm). Certains anciens plans ont
              été enregistrés avec la longueur du matelas déclaré et non la longueur
              réellement occupée par les patrons : la différence peut provenir d’une
              ancienne convention de calcul, pas nécessairement d’une corruption.
              La convention utilisée lors de l’enregistrement n’est pas identifiable.
            </Alert>
          )}
          {staleDraft && !remetricsPreview && (
            <Button
              size="small" variant="outlined"
              onClick={() => setRemetricsPreview(true)}
            >
              Recalculer les métriques
            </Button>
          )}
          {staleDraft && remetricsPreview && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              Enregistrer : longueur {plan.marker_length_cm.toFixed(1)} cm → {' '}
              {(recalculatedLength ?? 0).toFixed(1)} cm (recalcul serveur à partir
              des contours et validations actuels). Annuler ne modifie rien.
              {' '}La valeur affichée est une prévision : le serveur reste l’autorité.
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button
                  size="small" variant="contained" disabled={remetricsBusy}
                  onClick={() => { void confirmRemetrics(); }}
                >
                  {remetricsBusy ? 'Recalcul…' : 'Confirmer'}
                </Button>
                <Button
                  size="small" disabled={remetricsBusy}
                  onClick={() => setRemetricsPreview(false)}
                >
                  Annuler
                </Button>
              </Box>
            </Alert>
          )}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">Aucun plan ouvert.</Typography>
      )}
      <Divider />
      <Typography variant="subtitle2">Transfert Couture</Typography>
      {plan?.status === 'proposition' && (
        canValidatePlan ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              La validation verrouille définitivement le placement.
            </Typography>
            <Button
              variant="outlined"
              disabled={planDirty || placementCount === 0 || invalidCount > 0 || !summary?.readyForTransfer || validatingPlan}
              onClick={onValidatePlan}
            >
              {validatingPlan ? 'Validation…' : 'Valider le plan'}
            </Button>
            {planDirty && <Typography variant="caption">Enregistrez d’abord les modifications.</Typography>}
            {summary && !summary.readyForTransfer && (
              <Typography variant="caption">Placez toutes les pièces requises avant validation.</Typography>
            )}
          </Box>
        ) : (
          <Alert severity="info" sx={{ py: 0.5 }}>
            Ce plan doit être enregistré puis validé par le chef de coupe avant le transfert.
          </Alert>
        )
      )}
      {plan?.status === 'valide' && plan.theoretical && (
        <Alert severity="info" sx={{ py: 0.5 }}>
          <Typography variant="caption">
            Consommation théorique estimée
            {' '}({plan.theoretical.formula === 'C12'
              ? 'formule ORDNUR — tshirt'
              : `formule « panneaux » — ${plan.theoretical.family}`},
            {' '}GSM {plan.theoretical.grammageGm2}, wastage {plan.theoretical.wastagePct} %) :{' '}
            <strong>{plan.theoretical.netKgPerPiece.toFixed(4)} kg/pièce</strong>
            {' — '}total <strong>{plan.theoretical.kgWithWastage.toFixed(3)} kg</strong>
            {plan.theoretical.formula === 'C12' && (
              <> — {(plan.theoretical.netKgPerPiece * 12).toFixed(3)} kg/douzaine</>
            )}
            . Estimation théorique, pas une mesure réelle.
          </Typography>
        </Alert>
      )}
      {plan?.status === 'valide' && !plan.theoretical && plan.theoreticalUnavailable && (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          <Typography variant="caption">
            Estimation théorique indisponible : {plan.theoreticalUnavailable}
          </Typography>
        </Alert>
      )}
      {summary && (
        <>
          <Typography variant="caption" color="text.secondary">{modelLabel}</Typography>
          <TableContainer>
            <Table size="small" aria-label="Quantités par pièce">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ px: 0.5, py: 0.25 }}>Pièce</TableCell>
                  <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>Att.</TableCell>
                  <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>Plac.</TableCell>
                  <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>Val.</TableCell>
                  <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>Manq.</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.rows.map((row) => (
                  <TableRow key={row.pieceId}>
                    <TableCell sx={{ px: 0.5, py: 0.25 }}>
                      {row.label}
                      {row.expected === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          à configurer — non coupable
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>{row.expected}</TableCell>
                    <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>{row.placed}</TableCell>
                    <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}
                      style={{ color: row.invalid > 0 ? 'error.main' : undefined }}>
                      {row.valid}
                    </TableCell>
                    <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>{row.missing}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Row
            label="Attendues / placées / valides / manquantes"
            value={`${summary.model.expected} / ${summary.model.placed} / ${summary.model.valid} / ${summary.model.missing}`}
          />
          <Typography variant="body2" sx={{ fontWeight: 600, color: summary.readyForTransfer ? 'success.main' : 'warning.main' }}>
            {summary.readyForTransfer
              ? 'Prêt pour le transfert Couture (à la coupe réelle).'
              : 'Transfert Couture : placement incomplet ou invalide.'}
          </Typography>
          {plan?.status === 'valide' && plan.lot_id !== null && (
            <>
              <Alert severity="success" sx={{ py: 0.5 }}>
                Plan transféré : lot #{plan.lot_id} créé en Couture.
              </Alert>
              {plan.cutPieces.length > 0 ? (
                <>
                  <Typography variant="subtitle2">Pièces réellement coupées</Typography>
                  <TableContainer>
                    <Table size="small" aria-label="Relevé des pièces coupées">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ px: 0.5, py: 0.25 }}>Pièce</TableCell>
                          <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>Par couche</TableCell>
                          <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>Total coupé</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {plan.cutPieces.map((piece) => (
                          <TableRow key={piece.pieceId}>
                            <TableCell sx={{ px: 0.5, py: 0.25 }}>{piece.label}</TableCell>
                            <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>{piece.qtyPerLayer}</TableCell>
                            <TableCell align="right" sx={{ px: 0.5, py: 0.25 }}>{piece.totalQty}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Typography variant="caption" color="text.secondary">
                    Total : {plan.cutPieces.reduce((sum, piece) => sum + piece.totalQty, 0)} pièce(s)
                    {' '}sur {plan.layers} couche(s). Ce relevé est enregistré avec le transfert.
                  </Typography>
                </>
              ) : (
                <Alert severity="warning" sx={{ py: 0.5 }}>
                  Transfert historique : le détail des pièces coupées n’a pas été enregistré.
                </Alert>
              )}
            </>
          )}
          {canTransfer ? (
            <Button
              variant="contained"
              color="primary"
              onClick={() => setDialogOpen(true)}
            >
              Transférer vers la Couture
            </Button>
          ) : (
            <Button variant="contained" color="primary" disabled>
              Transférer vers la Couture
            </Button>
          )}
          {!canTransfer && plan && plan.lot_id === null && (
            <Typography variant="caption" color="text.secondary">
              {plan.status !== 'valide'
                ? 'Validez d’abord le plan (bouton ci-dessus) pour activer le transfert.'
                : invalidCount > 0 || !summary.readyForTransfer
                  ? 'Terminez le placement : toutes les pièces requises doivent être placées et valides.'
                  : 'Transfert indisponible pour le moment.'}
            </Typography>
          )}
          <TransferDialog
            open={dialogOpen}
            planId={plan?.id ?? 0}
            layers={plan?.layers ?? 1}
            rows={transferRows}
            onClose={() => setDialogOpen(false)}
            onConfirm={onTransfer}
          />
          <Typography variant="caption" color="text.secondary">
            Les pièces « placées » existent uniquement sur le canvas : aucune pièce physique
            n’est considérée comme coupée tant que le transfert n’a pas été exécuté.
          </Typography>
        </>
      )}
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</Typography>
    </Box>
  );
}
