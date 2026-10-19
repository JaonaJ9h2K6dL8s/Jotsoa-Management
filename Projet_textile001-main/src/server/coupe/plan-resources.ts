import { createHash } from 'node:crypto';
import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { addHistory, requireCoupe, requireId } from './common';
import type { NestingInput, NestingResult } from './nesting';

export function resourceFingerprint(actor: Actor, input: NestingInput, result: NestingResult, excludingPlan = 0): string {
  requireCoupe(actor);
  const db = sessionsDb();
  if (!input.lotId || !input.rollId || !input.coupeTableId) throw new ServiceError('Lot, rouleau et table obligatoires pour enregistrer un plan de production.',400);
  const lot = db.prepare('SELECT id,product_id,color_id,status FROM coupe_lots WHERE id=?').get(requireId(input.lotId,'Lot')) as {id:number;product_id:number;color_id:number;status:string} | undefined;
  if (!lot || lot.product_id !== input.productId || ['transfere','annule','bloque'].includes(lot.status)) throw new ServiceError('Lot absent, incompatible, bloqué ou déjà transféré.',409);
  const quantities = db.prepare('SELECT size_id,planned_qty FROM coupe_lot_sizes WHERE lot_id=? ORDER BY size_id').all(lot.id) as Array<{size_id:number;planned_qty:number}>;
  for (const selected of input.sizes) {
    const ordered = quantities.find((size)=>size.size_id===selected.sizeId)?.planned_qty ?? 0;
    const cut = (db.prepare('SELECT COALESCE(SUM(cut_qty),0) qty FROM coupe_results WHERE lot_id=? AND size_id=?').get(lot.id,selected.sizeId) as {qty:number}).qty;
    const reserved = (db.prepare(`SELECT COALESCE(SUM(json_extract(entry.value,'$.qty')),0) qty FROM marker_plans plan,json_each(plan.sizes_json) entry
      WHERE plan.lot_id=? AND plan.status='valide' AND plan.actual_json IS NULL AND plan.id!=? AND json_extract(entry.value,'$.sizeId')=?`).get(lot.id,excludingPlan,selected.sizeId) as {qty:number}).qty;
    if (selected.qty > ordered-cut-reserved) throw new ServiceError(`Taille ${selected.sizeId} : quantité supérieure au reste à couper (${Math.max(0,ordered-cut-reserved)}).`,409);
  }
  const roll = db.prepare('SELECT * FROM coupe_rolls WHERE id=?').get(requireId(input.rollId,'Rouleau')) as Record<string,unknown> | undefined;
  if (!roll || !['disponible','en_utilisation'].includes(String(roll.status))) throw new ServiceError('Rouleau indisponible.',409);
  if (roll.color_id !== lot.color_id) throw new ServiceError('Couleur du rouleau différente de celle du lot.',400);
  if (roll.qty_unit !== 'm' || roll.remaining_qty == null) throw new ServiceError('Longueur réelle restante du rouleau inconnue : renseignez-la en mètres. Aucune déduction automatique depuis le poids.',400);
  if (!roll.width_cm || !roll.usable_width_cm || !roll.grammage_g_m2) throw new ServiceError('Rouleau : largeur réelle, largeur utile et grammage obligatoires.',400);
  if (Number(roll.usable_width_cm) !== input.usableWidthCm || Number(roll.grammage_g_m2) !== input.grammageGm2) throw new ServiceError('Largeur utile ou grammage différents du rouleau : rechargez les valeurs enregistrées.',409);
  if (result.fiches.some((fiche)=>fiche.fabricType !== roll.fabric_ref)) throw new ServiceError('Tissu du rouleau incompatible avec la révision de patron sélectionnée.',400);
  const constraints = JSON.parse(String(roll.constraints_json)) as {reviewed?:boolean;motif?:string;maxLayers?:number;thicknessMm?:number;maxMatelasMm?:number;rollDefects?:unknown[]};
  if (constraints.reviewed !== true) throw new ServiceError('Les contraintes du tissu doivent être contrôlées avant préparation.',400);
  if (!['uni','sens_unique'].includes(constraints.motif ?? '')) throw new ServiceError('Raccord de rayures/motifs non pris en charge par le moteur : validation bloquée, expertise CAO nécessaire.',400);
  if (constraints.motif === 'sens_unique' && input.oneWay !== true) throw new ServiceError('Ce rouleau impose un sens unique.',400);
  if (!constraints.maxLayers || input.layers > constraints.maxLayers) throw new ServiceError('Nombre de couches incompatible avec la limite validée pour ce tissu.',400);
  if (constraints.thicknessMm && constraints.maxMatelasMm && constraints.thicknessMm*input.layers > constraints.maxMatelasMm) throw new ServiceError('Épaisseur du matelas supérieure à la capacité contrôlée.',400);
  if (constraints.rollDefects?.length) throw new ServiceError('Défauts repérés sur le rouleau : projection sur chaque couche non disponible. Préparez un tronçon contrôlé sans ces défauts avant de valider.',400);
  const rollReserved = (db.prepare(`SELECT COALESCE(SUM(matelas_length_cm*layers/100.0),0) metres FROM marker_plans WHERE roll_id=? AND status='valide' AND actual_json IS NULL AND id!=?`).get(input.rollId,excludingPlan) as {metres:number}).metres;
  if (result.consumptionM > Number(roll.remaining_qty)-rollReserved+1e-7) throw new ServiceError('Tissu insuffisant après réservation des autres plans.',409);
  const start = Date.parse(input.plannedStart ?? '');
  const end = Date.parse(input.plannedEnd ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new ServiceError('Créneau de coupe invalide : début et fin obligatoires.',400);
  const busy = db.prepare(`SELECT id FROM marker_plans WHERE coupe_table_id=? AND status='valide' AND actual_json IS NULL AND id!=?
    AND julianday(planned_start)<julianday(?) AND julianday(planned_end)>julianday(?)`).get(input.coupeTableId,excludingPlan,new Date(end).toISOString(),new Date(start).toISOString());
  if (busy) throw new ServiceError('Table déjà occupée sur ce créneau : choisissez une autre table ou un autre horaire.',409);
  return createHash('sha256').update(JSON.stringify({product:lot.product_id,color:lot.color_id,quantities,roll:{id:roll.id,fabric:roll.fabric_ref,
    width:roll.width_cm,usable:roll.usable_width_cm,grammage:roll.grammage_g_m2,color:roll.color_id,constraints},revisions:result.revisionIds})).digest('hex');
}

export function configureRoll(actor: Actor, input: Record<string,unknown>): void {
  requireCoupe(actor);
  const db = sessionsDb();
  const id = requireId(input.id,'Rouleau');
  const width = Number(input.widthCm);
  const usable = Number(input.usableWidthCm);
  const grammage = Number(input.grammageGm2);
  const remaining = Number(input.remainingM);
  const maxLayers = Number(input.maxLayers);
  const thicknessMm = input.thicknessMm == null || input.thicknessMm === '' ? null : Number(input.thicknessMm);
  const maxMatelasMm = input.maxMatelasMm == null || input.maxMatelasMm === '' ? null : Number(input.maxMatelasMm);
  if (![width,usable,grammage,remaining,maxLayers].every(Number.isFinite) || width <= 0 || width > 400 || usable <= 0 || usable > width || grammage <= 0 || grammage > 3000 || remaining < 0 || !Number.isInteger(maxLayers) || maxLayers < 1 || maxLayers > 200) throw new ServiceError('Dimensions, longueur, grammage ou couches du rouleau invalides.',400);
  if ([thicknessMm,maxMatelasMm].some((value)=>value != null && (!Number.isFinite(value) || value <= 0))) throw new ServiceError('Épaisseurs invalides.',400);
  if (!['uni','sens_unique','rayures','motif'].includes(String(input.motif)) || input.reviewed !== true) throw new ServiceError('Contrôle explicite des contraintes et du motif requis.',400);
  db.transaction(()=>{
    const old = db.prepare('SELECT * FROM coupe_rolls WHERE id=?').get(id) as Record<string,unknown> | undefined;
    if (!old) throw new ServiceError('Rouleau absent.',404);
    if (db.prepare("SELECT id FROM marker_plans WHERE roll_id=? AND status='valide' AND actual_json IS NULL").get(id)) throw new ServiceError('Rouleau réservé par un plan validé : sa configuration est protégée.',409);
    const previous = JSON.parse(String(old.constraints_json ?? '{}')) as Record<string,unknown>;
    db.prepare(`UPDATE coupe_rolls SET width_cm=?,usable_width_cm=?,grammage_g_m2=?,remaining_qty=?,qty_unit='m',fabric_lot=?,constraints_json=?,updated_at=datetime('now') WHERE id=?`)
      .run(width,usable,grammage,remaining,typeof input.fabricLot==='string'?input.fabricLot.slice(0,100):null,
        JSON.stringify({...previous,reviewed:true,motif:input.motif,maxLayers,thicknessMm,maxMatelasMm}),id);
    addHistory(db,{action:'ROLL_TECHNICAL_CHECK',entityType:'rouleau',entityId:id,actorId:actor.id,oldValue:old,newValue:{width,usable,grammage,remaining,maxLayers,thicknessMm,maxMatelasMm}});
  }).immediate();
}
