import TransferTicketPrint from '@/interfaces/cutting/TransferTicketPrint';
import { getTransferTicket } from '@/server/cutting/transfer-ticket';
import { getDb } from '@/server/db';
import { requirePageRole } from '@/server/auth/guards';

/**
 * Ticket de transfert imprimable (étape 17) : rendu hors navigation
 * (groupe de route dédié, sans AppShell) pour une impression A4
 * propre. Lecture seule : ouvrir ou imprimer ce ticket ne déclenche
 * aucun transfert, aucune consommation ni réception.
 */
export const metadata = { title: 'Bon de transfert Coupe → Couture' };

export const dynamic = 'force-dynamic';

export default async function TransferTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageRole('chef_coupe', 'admin', 'chef_couture');
  const { id } = await params;
  const ticket = getTransferTicket(getDb(), Number(id));
  return <TransferTicketPrint ticket={ticket} />;
}
