'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import { apiPost } from '@/services/api-client';
import type { LotWorkflowRow } from '@/server/coupe/lot-workflow';
import LotMatelasDialog from './lot-matelas-dialog';
import LotResultsDialog from './lot-results-dialog';
import LotTransferDialog from './lot-transfer-dialog';

/**
 * Actions du lot selon son statut du workflow. Une seule action
 * pertinente est proposée à chaque étape : vérifier, préparer, valider,
 * démarrer, enregistrer les résultats, préparer puis confirmer le
 * transfert.
 */

export default function LotWorkflowActions({
  lot,
  planId,
  onRefresh,
}: {
  lot: LotWorkflowRow;
  planId: number | null;
  onRefresh: () => void;
}) {
  const [matelasOpen, setMatelasOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(
    body: Record<string, unknown>,
    successMessage: string,
    after?: () => void,
  ) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/coupe/lots/${lot.id}/workflow`, body);
      setNotice(successMessage);
      onRefresh();
      after?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de l’opération.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {lot.status === 'brouillon' || lot.status === 'bloque' ? (
          <>
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() =>
                void run(
                  { action: 'check' },
                  'Vérifications exécutées : consultez l’état ci-dessous.',
                )
              }
            >
              Vérifier les données
            </Button>
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => setMatelasOpen(true)}
            >
              Préparer le matelas
            </Button>
          </>
        ) : null}

        {lot.status === 'plan_a_valider' ? (
          <Button
            variant="contained"
            color="success"
            disabled={busy}
            onClick={() =>
              void run(
                { action: 'validate_plan' },
                'Plan validé — le lot est prêt à couper.',
              )
            }
          >
            Valider le plan
          </Button>
        ) : null}

        {lot.status === 'pret_a_couper' ? (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              void run({ action: 'start_cutting' }, 'Coupe démarrée.')
            }
          >
            Démarrer la coupe
          </Button>
        ) : null}

        {lot.status === 'en_coupe' ? (
          <Button
            variant="contained"
            color="warning"
            disabled={busy}
            onClick={() => setResultsOpen(true)}
          >
            Enregistrer les résultats réels
          </Button>
        ) : null}

        {lot.status === 'resultat_a_confirmer' ? (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              void run(
                { action: 'confirm_results' },
                'Résultats confirmés — ticket de coupe généré.',
              )
            }
          >
            Confirmer les résultats
          </Button>
        ) : null}

        {lot.status === 'coupe' ? (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              void run(
                { action: 'prepare_transfer' },
                'Transfert préparé — remise physique à confirmer.',
              )
            }
          >
            Préparer le transfert
          </Button>
        ) : null}

        {lot.status === 'transfert_pret' ? (
          <Button
            variant="contained"
            color="success"
            disabled={busy}
            onClick={() => setTransferOpen(true)}
          >
            Confirmer la remise à la couture
          </Button>
        ) : null}

        {planId && !['en_coupe', 'resultat_a_confirmer', 'coupe', 'transfert_pret', 'pret_transfert', 'transfere'].includes(lot.status) ? (
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => setMatelasOpen(true)}
          >
            Régénérer le plan
          </Button>
        ) : null}
      </Stack>

      {lot.status === 'en_coupe' ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          Coupe en cours — enregistrez les quantités réellement coupées à la
          fin de l&apos;opération.
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}

      <LotMatelasDialog
        open={matelasOpen}
        onClose={() => setMatelasOpen(false)}
        lot={lot}
        onDone={() => {
          setMatelasOpen(false);
          setNotice('Plan de placement généré.');
          onRefresh();
        }}
      />
      <LotResultsDialog
        open={resultsOpen}
        onClose={() => setResultsOpen(false)}
        lot={lot}
        onDone={() => {
          setResultsOpen(false);
          onRefresh();
        }}
      />
      <LotTransferDialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        lot={lot}
        onDone={() => {
          setTransferOpen(false);
          onRefresh();
        }}
      />
      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </Box>
  );
}
