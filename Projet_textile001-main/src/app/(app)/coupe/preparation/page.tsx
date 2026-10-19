import { requirePageRole } from '@/server/auth/guards';
import Atelier from '@/interfaces/coupe/atelier';

export const metadata = {title:'Préparation de coupe et patrons vérifiés'};
export default async function PreparationPage() {
  await requirePageRole('chef_coupe');
  return <Atelier />;
}
