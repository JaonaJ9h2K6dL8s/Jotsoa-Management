import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { requireCoupe, requireId } from './common';
import { getValidatedPatterns, type PatternPiece } from './patterns';
import { packContours, permittedRotations, verifyLayout } from './polygon-packing';
import { bounds, polygonArea, transformContour, type FabricZone } from '@/lib/coupe-geometry';
import type { FicheDetail } from './fiches';

export interface NestingPlacement {
  patternId: number; pieceCode: string; pieceLabel: string; sizeId: number; sizeNom: string;
  x: number; y: number; widthCm: number; heightCm: number; rotation: number; points: Array<{x:number;y:number}>;
}
export interface NestingInput {
  productId: number; category?: string; sizes: Array<{sizeId:number;qty:number}>;
  usableWidthCm: number; matelasLengthCm: number; layers: number; gapCm: number; grammageGm2?: number | null;
  wShrinkagePct?: number | null; lShrinkagePct?: number | null; coupeTableId?: number | null;
  revisionIds?: number[]; modelName?: string; fabricRef?: string; rollId?: number | null; lotId?: number | null;
  plannedStart?: string; plannedEnd?: string; marginCm?: number; defects?: FabricZone[]; oneWay?: boolean;
  optimize?: boolean; compensationVerified?: boolean;
  manualLayout?: Array<{patternId:number;x:number;y:number;rotation:number}>;
}
export interface NestingResult {
  placements: NestingPlacement[]; markerLengthCm: number; usableWidthCm: number; layers: number;
  totalPiecesPerLayer: number; totalPiecesAllLayers: number; placedAreaM2: number; availableAreaM2: number;
  efficiency: number; wasteAreaM2: number; wasteKgEst: number | null; jobLengthM: number; warnings: string[];
  patternPieces: PatternPiece[]; wShrinkagePct: number; lShrinkagePct: number;
  matelasLengthCm: number; marginCm: number; defects: FabricZone[]; oneWay: boolean; method: string;
  availableAreaAllLayersM2: number; placedAreaAllLayersM2: number; unusedAreaAllLayersM2: number;
  consumptionM: number; consumptionKg: number | null; garmentCount: number;
  fiches: FicheDetail[]; revisionIds: number[];
}

function finite(raw: unknown, label: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new ServiceError(`${label} invalide (${min} à ${max}).`,400);
  return value;
}

export function computeMarker(actor: Actor, input: NestingInput): NestingResult {
  requireCoupe(actor);
  const productId = requireId(input.productId,'Produit');
  const width = finite(input.usableWidthCm,'Largeur utile (cm)',0.1,400);
  const length = finite(input.matelasLengthCm,'Longueur du matelas (cm)',0.1,1200);
  const layers = finite(input.layers,'Couches',1,200);
  const gap = finite(input.gapCm,'Espacement (cm)',0,10);
  const margin = finite(input.marginCm ?? 0,'Marge de sécurité (cm)',0,50);
  if (!Number.isInteger(layers)) throw new ServiceError('Le nombre de couches doit être entier.',400);
  if (!Array.isArray(input.sizes) || !input.sizes.length || input.sizes.length > 30) throw new ServiceError('Sélectionnez les tailles et quantités à couper.',400);
  const ids = input.sizes.map((size) => requireId(size.sizeId,'Taille'));
  if (new Set(ids).size !== ids.length) throw new ServiceError('Tailles dupliquées.',400);
  for (const size of input.sizes) {
    if (!Number.isInteger(size.qty) || size.qty < 1 || size.qty > 100000) throw new ServiceError('Quantité entière positive requise.',400);
    if (size.qty % layers !== 0) throw new ServiceError(`La quantité ${size.qty} n’est pas divisible par ${layers} couches : réduisez les couches ou préparez un matelas complémentaire. Aucune surproduction automatique.`,400);
  }
  const db = sessionsDb();
  if (input.coupeTableId) {
    const table = db.prepare('SELECT * FROM coupe_tables WHERE id=? AND is_active=1').get(requireId(input.coupeTableId,'Table')) as {longueur_max_cm:number;largeur_utile_cm:number;couches_max:number} | undefined;
    if (!table) throw new ServiceError('Table inactive ou absente.',400);
    if (length > table.longueur_max_cm) throw new ServiceError('Longueur du matelas supérieure à la capacité de la table.',400);
    if (width > table.largeur_utile_cm) throw new ServiceError('Largeur utile supérieure à celle de la table.',400);
    if (layers > table.couches_max) throw new ServiceError('Nombre de couches supérieur à la limite de la table.',400);
  }
  const wShrinkagePct = finite(input.wShrinkagePct ?? 100,'Retrait largeur (%)',80,100);
  const lShrinkagePct = finite(input.lShrinkagePct ?? 100,'Retrait longueur (%)',80,100);
  if ((wShrinkagePct !== 100 || lShrinkagePct !== 100) && input.compensationVerified !== true) throw new ServiceError('Confirmez la compensation des retraits : elle ne doit pas déjà être intégrée aux contours.',400);
  const scaleX = 100 / wShrinkagePct;
  const scaleY = 100 / lShrinkagePct;
  const selected = getValidatedPatterns(actor,{productId,category:input.category,sizeIds:ids,revisionIds:input.revisionIds,modelName:input.modelName,fabricRef:input.fabricRef});
  if (selected.warnings.length || !selected.items.length) throw new ServiceError(selected.warnings.join(' ') || 'Aucun patron réel approuvé.',400);
  const patterns = selected.items;
  const revisionIds = [...new Set(patterns.map((piece) => piece.revisionId))];
  const revisions = db.prepare(`SELECT model_name,fabric_ref,fiche_snapshot_json FROM pattern_revisions WHERE id IN (${revisionIds.map(()=>'?').join(',')})`).all(...revisionIds) as Array<{model_name:string;fabric_ref:string;fiche_snapshot_json:string}>;
  if (new Set(revisions.map((revision) => revision.model_name)).size !== 1 || new Set(revisions.map((revision) => revision.fabric_ref)).size !== 1) throw new ServiceError('Les tailles d’un plan doivent partager le même modèle et le même tissu.',400);
  const defects = input.defects ?? [];
  if (!Array.isArray(defects) || defects.length > 60) throw new ServiceError('Liste de défauts invalide.',400);
  defects.forEach((zone) => {
    if (!zone || ![zone.x,zone.y,zone.widthCm,zone.heightCm].every(Number.isFinite) || zone.x < 0 || zone.y < 0 || zone.widthCm <= 0 || zone.heightCm <= 0 || zone.x + zone.widthCm > width || zone.y + zone.heightCm > length || typeof zone.label !== 'string' || !zone.label.trim() || zone.label.length > 100) throw new ServiceError('Défaut hors tissu ou dimensions/libellé manquants.',400);
  });
  const pieceCount = input.sizes.reduce((sum,size)=>sum+patterns.filter((piece)=>piece.sizeId===size.sizeId).reduce((count,piece)=>count+size.qty/layers*piece.qtyMultiplier,0),0);
  if (pieceCount > 300) throw new ServiceError('Plus de 300 contours par couche : répartissez la production en plusieurs plans.',400);
  const items = input.sizes.flatMap((size) => patterns.filter((piece) => piece.sizeId === size.sizeId).flatMap((piece) => Array.from({length:size.qty/layers*piece.qtyMultiplier},()=>piece)));
  const oneWay = input.oneWay === true;
  let placements: NestingPlacement[];
  if (input.manualLayout) {
    if (!Array.isArray(input.manualLayout) || input.manualLayout.length !== items.length) throw new ServiceError('Le déplacement manuel ne peut pas ajouter ou supprimer des pièces.',400);
    const remaining = new Map<number,number>();
    items.forEach((piece)=>remaining.set(piece.id,(remaining.get(piece.id)??0)+1));
    placements = input.manualLayout.map((position) => {
      const piece = patterns.find((candidate)=>candidate.id===position.patternId);
      if (!piece || !remaining.get(piece.id) || ![position.x,position.y,position.rotation].every(Number.isFinite) || !permittedRotations(piece,oneWay).includes(position.rotation)) throw new ServiceError('Pièce, position ou rotation manuelle non autorisée.',400);
      remaining.set(piece.id,remaining.get(piece.id)!-1);
      const local = transformContour(piece.points,position.rotation,scaleX,scaleY);
      const box = bounds(local);
      return {patternId:piece.id,pieceCode:piece.pieceCode,pieceLabel:piece.pieceLabel,sizeId:piece.sizeId,sizeNom:piece.sizeNom,
        x:position.x,y:position.y,widthCm:box.width,heightCm:box.height,rotation:position.rotation,
        points:local.map((point)=>({x:point.x+position.x,y:point.y+position.y}))};
    });
  } else placements = packContours(items,width,length,gap,margin,defects,oneWay,scaleX,scaleY,input.optimize !== false);
  verifyLayout(placements,width,length,gap,margin,defects);
  const placed = placements.reduce((total,placement)=>total+polygonArea(placement.points)/10000,0);
  const available = width*length/10000;
  const unused = Math.max(0,available-placed);
  const grammage = input.grammageGm2 == null ? null : finite(input.grammageGm2,'Grammage',1,3000);
  return {placements,markerLengthCm:Math.ceil(Math.max(...placements.map((piece)=>piece.y+piece.heightCm))*100)/100,
    matelasLengthCm:length,usableWidthCm:width,layers,totalPiecesPerLayer:placements.length,totalPiecesAllLayers:placements.length*layers,
    placedAreaM2:placed,availableAreaM2:available,efficiency:placed/available*100,wasteAreaM2:unused,
    wasteKgEst:grammage == null ? null : unused*layers*grammage/1000,jobLengthM:placed/(width/100),
    patternPieces:patterns,wShrinkagePct,lShrinkagePct,marginCm:margin,defects,oneWay,
    method:input.manualLayout ? 'Placement manuel contrôlé' : input.optimize === false ? 'Placement glouton rapide par contours' : 'Placement glouton par contours et ancrages de sommets',
    availableAreaAllLayersM2:available*layers,placedAreaAllLayersM2:placed*layers,unusedAreaAllLayersM2:unused*layers,
    consumptionM:length*layers/100,consumptionKg:grammage == null ? null : available*layers*grammage/1000,
    garmentCount:input.sizes.reduce((total,size)=>total+size.qty,0),fiches:revisions.map((revision)=>JSON.parse(revision.fiche_snapshot_json) as FicheDetail),revisionIds,
    warnings:['Heuristique : optimum global non garanti. Validation du responsable obligatoire.','La surface non utilisée est théorique ; elle ne constitue pas une déclaration de déchets.']};
}
