import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { addHistory, requireCoupe, requireId } from './common';
import { computeMarker, type NestingInput, type NestingResult } from './nesting';
import { resourceFingerprint } from './plan-resources';
import { storeTicket } from './tickets';

export interface MarkerPlanRow {
  id:number;lotId:number|null;productId:number;productName:string;category:'adulte'|'enfant';usableWidthCm:number;
  matelasLengthCm:number;layers:number;gapCm:number;grammageGm2:number|null;markerLengthCm:number;totalPieces:number;
  placedAreaM2:number;availableAreaM2:number;efficiency:number;wasteAreaM2:number;wasteKgEst:number|null;status:'proposition'|'valide';
  createdBy:number;createdByName:string|null;createdAt:string;coupeTableId:number|null;coupeTableNom:string|null;
  sizes:Array<{sizeId:number;qty:number}>;result:NestingResult|null;
  input?:NestingInput|null;validatedAt?:string|null;resultTaskId?:number|null;actual?:Record<string,unknown>|null;
}
const LIST_SQL = `SELECT mp.*,p.nom product_name,u.nom || ' ' || u.prenom created_by_name,ct.nom coupe_table_nom FROM marker_plans mp
  JOIN products p ON p.id=mp.product_id JOIN users u ON u.id=mp.created_by LEFT JOIN coupe_tables ct ON ct.id=mp.coupe_table_id`;
function mapPlan(row:Record<string,unknown>,withResult:boolean):MarkerPlanRow {
  return {id:Number(row.id),lotId:row.lot_id as number|null,productId:Number(row.product_id),productName:String(row.product_name),category:row.category as MarkerPlanRow['category'],
    usableWidthCm:Number(row.usable_width_cm),matelasLengthCm:Number(row.matelas_length_cm),layers:Number(row.layers),gapCm:Number(row.gap_cm),grammageGm2:row.grammage_g_m2 as number|null,
    markerLengthCm:Number(row.marker_length_cm),totalPieces:Number(row.total_pieces),placedAreaM2:Number(row.placed_area_m2),availableAreaM2:Number(row.available_area_m2),efficiency:Number(row.efficiency),
    wasteAreaM2:Number(row.waste_area_m2),wasteKgEst:row.waste_kg_est as number|null,status:row.status as MarkerPlanRow['status'],createdBy:Number(row.created_by),createdByName:row.created_by_name as string|null,
    createdAt:String(row.created_at),coupeTableId:row.coupe_table_id as number|null,coupeTableNom:row.coupe_table_nom as string|null,
    sizes:JSON.parse(String(row.sizes_json)),result:withResult?JSON.parse(String(row.pieces_json)):null,input:row.input_json?JSON.parse(String(row.input_json)):null,
    validatedAt:row.validated_at as string|null,resultTaskId:row.result_task_id as number|null,actual:row.actual_json?JSON.parse(String(row.actual_json)):null};
}

export function createMarkerPlan(actor:Actor,body:NestingInput & {lotId?:number|null; excludingPlan?: number}):MarkerPlanRow {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(()=>{
    const result = computeMarker(actor,body);
    const canonical:NestingInput = {...body,revisionIds:result.revisionIds,category:result.patternPieces[0].category};
    const fingerprint = resourceFingerprint(actor,canonical,result,body.excludingPlan ?? 0);
    const inserted = db.prepare(`INSERT INTO marker_plans (lot_id,product_id,category,usable_width_cm,matelas_length_cm,layers,gap_cm,grammage_g_m2,sizes_json,pieces_json,
      marker_length_cm,total_pieces,placed_area_m2,available_area_m2,efficiency,waste_area_m2,waste_kg_est,status,created_by,coupe_table_id,input_json,source_fingerprint,roll_id,planned_start,planned_end)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposition',?,?,?,?,?,?,?)`).run(body.lotId,body.productId,canonical.category,result.usableWidthCm,body.matelasLengthCm,result.layers,body.gapCm,
      body.grammageGm2??null,JSON.stringify(body.sizes),JSON.stringify(result),result.markerLengthCm,result.totalPiecesPerLayer,result.placedAreaM2,result.availableAreaM2,result.efficiency,
      result.wasteAreaM2,result.wasteKgEst,actor.id,body.coupeTableId,JSON.stringify(canonical),fingerprint,body.rollId,new Date(body.plannedStart!).toISOString(),new Date(body.plannedEnd!).toISOString());
    const id = Number(inserted.lastInsertRowid);
    addHistory(db,{action:'marker_propose',entityType:'marker_plan',entityId:id,actorId:actor.id,newValue:{revisionIds:result.revisionIds,lotId:body.lotId,method:result.method}});
    return getMarkerPlan(actor,id);
  }).immediate();
}

export function listMarkerPlans(actor:Actor,limit=30):MarkerPlanRow[] {
  requireCoupe(actor);
  return (sessionsDb().prepare(`${LIST_SQL} ORDER BY mp.id DESC LIMIT ?`).all(Math.min(200,Math.max(1,Math.trunc(limit)))) as Array<Record<string,unknown>>).map((row)=>mapPlan(row,false));
}
export function getMarkerPlan(actor:Actor,planId:number):MarkerPlanRow {
  requireCoupe(actor);
  const row = sessionsDb().prepare(`${LIST_SQL} WHERE mp.id=?`).get(requireId(planId,'Plan')) as Record<string,unknown>|undefined;
  if (!row) throw new ServiceError('Plan de marker introuvable.',404);
  return mapPlan(row,true);
}
export function getLatestValidatedPlanForProduct(actor:Actor,productId:number,ficheId?:number,ficheVersion?:number):MarkerPlanRow|null {
  requireCoupe(actor);
  if (!ficheId || !ficheVersion) return null;
  const rows = sessionsDb().prepare(`${LIST_SQL} WHERE mp.product_id=? AND mp.status='valide' AND mp.input_json IS NOT NULL ORDER BY mp.id DESC`)
    .all(requireId(productId,'Produit')) as Array<Record<string,unknown>>;
  const matching = rows.map((row)=>mapPlan(row,true)).filter((plan)=>plan.result?.fiches?.some((fiche)=>fiche.id===ficheId&&fiche.version===ficheVersion));
  return matching.length === 1 ? matching[0] : null;
}
export function listCoupeTables(actor:Actor):Array<{id:number;nom:string;largeurCm:number;longueurMaxCm:number;largeurUtileCm:number;couchesMax:number}> {
  requireCoupe(actor);
  return sessionsDb().prepare(`SELECT id,nom,largeur_cm largeurCm,longueur_max_cm longueurMaxCm,largeur_utile_cm largeurUtileCm,couches_max couchesMax FROM coupe_tables WHERE is_active=1 ORDER BY nom`).all() as ReturnType<typeof listCoupeTables>;
}
export function validateMarkerPlan(actor:Actor,planId:number):MarkerPlanRow {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(()=>{
    const plan = getMarkerPlan(actor,planId);
    if (plan.status==='valide') throw new ServiceError('Ce plan est déjà validé : double validation refusée.',409);
    if (!plan.input || !plan.result) throw new ServiceError('Ancienne proposition sans provenance vérifiable : créez un nouveau plan à partir de patrons approuvés.',409);
    const result = computeMarker(actor,{...plan.input,manualLayout:plan.result.placements});
    // Si un ancien plan validé existe pour le même lot, il ne doit pas
    // bloquer la validation du nouveau plan : seul le plan actuel est
    // pris en compte pour les réservations.
    const previousValidated = db.prepare("SELECT id FROM marker_plans WHERE lot_id=? AND status='valide' AND id!=?")
      .all(plan.lotId, plan.id) as Array<{id:number}>;
    const excludingPlan = previousValidated.length ? previousValidated[0].id : 0;
    const fingerprint = resourceFingerprint(actor,plan.input,result,excludingPlan);
    const stored = db.prepare('SELECT source_fingerprint FROM marker_plans WHERE id=?').get(plan.id) as {source_fingerprint:string};
    if (stored.source_fingerprint!==fingerprint || JSON.stringify(result.patternPieces)!==JSON.stringify(plan.result.patternPieces)) throw new ServiceError('Commande, rouleau ou patrons modifiés depuis la préparation : générez un nouveau brouillon.',409);
    db.prepare(`UPDATE marker_plans SET status='valide',validated_by=?,validated_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).run(actor.id,plan.id);
    addHistory(db,{action:'marker_validate',entityType:'marker_plan',entityId:plan.id,actorId:actor.id,newValue:{revisionIds:result.revisionIds}});
    storeTicket(actor,{type:'coupe',lotId:plan.lotId,planId:plan.id,refOperation:`MK-${plan.id}`,payload:{sizes:plan.sizes,table:plan.coupeTableNom,layers:plan.layers,matelasLengthCm:plan.matelasLengthCm,revisionIds:result.revisionIds,expectedPieces:result.totalPiecesAllLayers}});
    return getMarkerPlan(actor,plan.id);
  }).immediate();
}

export function moveMarkerPieces(actor:Actor,planId:number,layout:NestingInput['manualLayout']):MarkerPlanRow {
  requireCoupe(actor);
  const plan = getMarkerPlan(actor,planId);
  if (!plan.input || plan.status==='valide') throw new ServiceError('Plan validé ou historique : créez une nouvelle version, ne modifiez pas cette production.',409);
  return createMarkerPlan(actor,{...plan.input,manualLayout:layout});
}
