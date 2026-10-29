'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import type { TransferTicketDTO } from '@/types/cutting-ticket';

/**
 * Ticket imprimable « BON DE TRANSFERT — COUPE VERS COUTURE » (étape 17).
 * Consultation/impression seule : aucun appel d'action, aucun effet
 * sur la base. Mise en page A4 en CSS pur, hors ligne, sans CDN.
 * Avant réception, la partie réception affiche clairement
 * « EN ATTENTE DE RÉCEPTION » ; après réception, les quantités reçues
 * et les écarts sont réimprimés tels qu'enregistrés.
 */

const CELL: React.CSSProperties = {
  border: '1px solid #333', padding: '4px 6px', fontSize: 12,
  textAlign: 'left',
};

function Row({
  label, value, empty = 'Non renseigné',
}: { label: string; value: string | null | undefined; empty?: string }) {
  return (
    <tr>
      <td style={{ ...CELL, fontWeight: 600, width: 180 }}>{label}</td>
      <td style={CELL}>{value === null || value === undefined || value === '' ? empty : value}</td>
    </tr>
  );
}

export default function TransferTicketPrint({ ticket }: { ticket: TransferTicketDTO }) {
  const totalSent = ticket.pieces.reduce((sum, piece) => sum + piece.qtySent, 0);
  const reception = ticket.reception;
  return (
    <Stack sx={{ p: 2, maxWidth: 900, mx: 'auto' }} spacing={2}>
      <Box className="ticket-print-hide" sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => window.print()}>Imprimer (A4)</Button>
      </Box>
      <div>
        <style>{`
          @media print {
            .ticket-print-hide { display: none !important; }
            body { margin: 0; }
          }
          @page { size: A4 portrait; margin: 15mm; }
        `}</style>
        <div style={{ fontFamily: 'Arial, sans-serif', color: '#111' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{ticket.appName}</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
              BON DE TRANSFERT — COUPE VERS COUTURE
            </div>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 12 }}>
            <tbody>
              <Row
                label="Numéro du ticket"
                value={ticket.ticketNo ?? `${ticket.code} (historique sans ticket numéroté)`}
              />
              <Row label="Date et heure d'envoi" value={ticket.confirmedAt} />
              <Row
                label="Statut"
                value={reception
                  ? (reception.status === 'complete'
                    ? 'Réceptionné' : 'Réception partielle')
                  : 'Envoyé — en attente de réception'}
              />
              <Row label="Atelier de départ" value="Coupe" />
              <Row label="Atelier destinataire" value="Couture" />
              <Row label="Référence du lot" value={ticket.lotCode} />
              <Row
                label="Plan de coupe associé"
                value={ticket.planId !== null ? `#${ticket.planId}` : null}
                empty="—"
              />
              <Row label="Produit" value={ticket.productName} />
              <Row label="Couleur" value={ticket.colorName} />
            </tbody>
          </table>

          <div style={{ fontWeight: 700, marginTop: 14, marginBottom: 4 }}>
            Détail des pièces
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={CELL}>Référence de pièce</th>
                <th style={CELL}>Désignation</th>
                <th style={{ ...CELL, textAlign: 'right' }}>Prévue</th>
                <th style={{ ...CELL, textAlign: 'right' }}>Par couche</th>
                <th style={{ ...CELL, textAlign: 'right' }}>Couches</th>
                <th style={{ ...CELL, textAlign: 'right' }}>Quantité envoyée</th>
              </tr>
            </thead>
            <tbody>
              {ticket.pieces.map((piece) => (
                <tr key={piece.pieceId}>
                  <td style={CELL}>{piece.code}</td>
                  <td style={CELL}>{piece.label}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    {piece.qtyPlanned === null ? 'Non renseigné' : piece.qtyPlanned}
                  </td>
                  <td style={{ ...CELL, textAlign: 'right' }}>{piece.qtyPerLayer}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}>{piece.layers}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}>{piece.qtySent}</td>
                </tr>
              ))}
              {ticket.pieces.length === 0 && (
                <tr>
                  <td style={CELL} colSpan={6}>
                    Transfert historique : le détail des pièces n&apos;a pas
                    été enregistré à l&apos;époque.
                  </td>
                </tr>
              )}
              {ticket.pieces.length > 0 && (
                <tr>
                  <td style={{ ...CELL, fontWeight: 700 }} colSpan={5}>
                    Total des pièces envoyées
                  </td>
                  <td style={{ ...CELL, textAlign: 'right', fontWeight: 700 }}>{totalSent}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ fontWeight: 700, marginTop: 14, marginBottom: 4 }}>
            Réception (par taille)
          </div>
          {reception === null ? (
            <div style={{
              border: '2px dashed #555', padding: 10, textAlign: 'center',
              fontWeight: 700, fontSize: 14,
            }}>
              EN ATTENTE DE RÉCEPTION
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={CELL}>Taille</th>
                  <th style={{ ...CELL, textAlign: 'right' }}>Quantité envoyée</th>
                  <th style={{ ...CELL, textAlign: 'right' }}>Quantité reçue</th>
                  <th style={CELL}>Observation</th>
                </tr>
              </thead>
              <tbody>
                {ticket.sizes.map((size) => (
                  <tr key={size.sizeId}>
                    <td style={CELL}>{size.sizeLabel}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{size.qtySent}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      {size.qtyReceived === null ? 'Non renseigné' : size.qtyReceived}
                    </td>
                    <td style={CELL}>{size.observation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {reception !== null && reception.notes && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Observations de réception : {reception.notes}
            </div>
          )}

          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 16 }}>
            <tbody>
              <tr>
                <td style={{ ...CELL, width: '50%', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 700 }}>Responsable de l&apos;envoi (Coupe)</div>
                  <div>{ticket.emitter.name}</div>
                  <div style={{ fontSize: 11 }}>
                    {ticket.emitter.role ?? 'Fonction non renseignée'} — {ticket.confirmedAt}
                  </div>
                  {ticket.emitter.notes && (
                    <div style={{ fontSize: 11 }}>{ticket.emitter.notes}</div>
                  )}
                  <div style={{ marginTop: 40, borderTop: '1px solid #333' }}>
                    Signature de l&apos;émetteur
                  </div>
                </td>
                <td style={{ ...CELL, width: '50%', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 700 }}>Réceptionnaire (Couture)</div>
                  {reception ? (
                    <>
                      <div>{reception.receivedByName ?? 'Non renseigné'}</div>
                      <div style={{ fontSize: 11 }}>Reçu le {reception.receivedAt}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12 }}>En attente de réception</div>
                  )}
                  <div style={{ marginTop: 40, borderTop: '1px solid #333' }}>
                    Signature du réceptionnaire
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 10, marginTop: 10, color: '#555' }}>
            Ce ticket est une preuve de remise entre deux responsables.
            La quantité envoyée est distincte de la quantité effectivement
            reçue ; la réception ne vaut que confirmée par un utilisateur
            autorisé de la Couture.
          </div>
        </div>
      </div>
    </Stack>
  );
}
