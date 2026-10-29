import DonneesCoupe from '@/interfaces/cutting/DonneesCoupe';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Rouleaux & Produits — Atelier Coupe' };

export const dynamic = 'force-dynamic';

export default async function CoupeDonneesPage() {
  await requirePageRole('chef_coupe');
  return <DonneesCoupe />;
}
