import { NextResponse } from 'next/server';
import { toApiError } from '@/server/api/error-response';
import { serviceErrorCode } from '@/server/api/service-error';
import { requireApiRole } from '@/server/auth/guards';
import {
  createProduct,
  listCatalogue,
  type CatalogueProduct,
} from '@/server/catalogue/catalogue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Catalogue groupé par catégorie — consultable par tout rôle actif. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireApiRole(
    'admin',
    'chef_coupe',
    'chef_couture',
    'controleur_qualite',
    'retoucheur',
    'chef_stock',
    'chef_magasinier',
    'chef_securite',
  );
  if (!guard.ok) return guard.response;
  try {
    const categories = listCatalogue(guard.user);
    return NextResponse.json({ status: 'ok', item: categories });
  } catch (error) {
    return NextResponse.json(toApiError(error, 'Erreur de chargement du catalogue.'), {
      status: serviceErrorCode(error),
    });
  }
}

/** Création rapide d'un produit depuis les listes déroulantes. */
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireApiRole(
    'admin',
    'chef_coupe',
    'chef_stock',
    'chef_magasinier',
  );
  if (!guard.ok) return guard.response;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const product: CatalogueProduct = createProduct(guard.user, {
      nom: String(body?.nom ?? ''),
      typeId: Number(body?.typeId ?? 0),
      description: body?.description ? String(body.description) : null,
    });
    return NextResponse.json({ status: 'ok', item: product }, { status: 201 });
  } catch (error) {
    return NextResponse.json(toApiError(error, 'Erreur lors de la création du produit.'), {
      status: serviceErrorCode(error),
    });
  }
}
