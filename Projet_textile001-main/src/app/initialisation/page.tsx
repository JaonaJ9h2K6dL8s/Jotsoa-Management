import { redirect } from 'next/navigation';

/**
 * Le formulaire de création du compte administrateur est désormais
 * intégré à la page de connexion (bascule sur le panneau droit).
 */
export default function InitialisationPage() {
  redirect('/login');
}
