import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { addHistory, normalizeText, requireCoupe } from './common';
import { getMarkerPlan } from './marker';
import { createTask } from './tasks';
import { patchTask, setTaskResults, validateTask } from './task-actions';
import { storeTicket } from './tickets';

export function recordPlanActual(actor:Actor,planId:number,input:Record<string,unknown>) {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(()=>{
    const plan = getMarkerPlan(actor,planId);
    if (plan.status!=='valide' || !plan.input || !plan.result || !plan.lotId) throw new ServiceError('Un plan traçable validé et lié à un lot est requis.',409);
    if (plan.actual) throw new ServiceError('Résultats déjà enregistrés : double comptage refusé.',409);
    const lengthM = Number(input.lengthM);
    const layers = Number(input.layers);
    const weightKg = Number(input.weightKg);
    const reusableKg = Number(input.reusableKg);
    const wasteKg = Number(input.wasteKg);
    const reason = normalizeText(input.reason,500);
    if ([input.lengthM,input.layers,input.weightKg,input.reusableKg,input.wasteKg].some((value)=>value==null||value==='') ||
      ![lengthM,layers,weightKg,reusableKg,wasteKg].every(Number.isFinite) || lengthM<=0 || !Number.isInteger(layers) || layers<1 || weightKg<=0 || reusableKg<0 || wasteKg<0 || reusableKg+wasteKg>weightKg) throw new ServiceError('Mesures réelles obligatoires et cohérentes : matelas (m), couches, poids utilisé, chutes et déchets (kg).',400);
    const components = input.components;
    if (!Array.isArray(components) || components.length!==plan.result.patternPieces.length) throw new ServiceError('Renseignez chaque pièce de patron coupée, séparément par composant et taille.',400);
    const seen = new Set<number>();
    const rows = components.map((raw:Record<string,unknown>)=>{
      const patternId = Number(raw.patternId);
      const piece = plan.result!.patternPieces.find((candidate)=>candidate.id===patternId);
      const cutQty = Number(raw.cutQty);
      const usableQty = Number(raw.usableQty);
      if (!piece || seen.has(patternId) || raw.cutQty==null || raw.usableQty==null || !Number.isInteger(cutQty) || !Number.isInteger(usableQty) || usableQty<0 || cutQty<usableQty) throw new ServiceError('Comptage des composants invalide ou dupliqué.',400);
      seen.add(patternId);
      const expectedQty = plan.sizes.find((size)=>size.sizeId===piece.sizeId)!.qty*piece.qtyMultiplier;
      return {patternId,sizeId:piece.sizeId,component:piece.component,qtyMultiplier:piece.qtyMultiplier,expectedQty,cutQty,usableQty};
    });
    const results = plan.sizes.map((size)=>{
      const matching = rows.filter((row)=>row.sizeId===size.sizeId);
      const cutQty = Math.min(...matching.map((row)=>Math.floor(row.cutQty/row.qtyMultiplier)));
      const usableQty = Math.min(...matching.map((row)=>Math.floor(row.usableQty/row.qtyMultiplier)));
      return {sizeId:size.sizeId,cutQty,usableQty,anomalyQty:cutQty-usableQty,wasteQty:0};
    });
    const discrepancy = rows.some((row)=>row.cutQty!==row.expectedQty || row.usableQty!==row.cutQty) ||
      Math.abs(lengthM*100-plan.matelasLengthCm)>0.01 || layers!==plan.layers;
    if (discrepancy && !reason) throw new ServiceError('Un motif est obligatoire pour les écarts de quantités, défauts, couches ou longueur.',400);
    const rollId = plan.input.rollId!;
    const roll = db.prepare('SELECT remaining_qty,qty_unit FROM coupe_rolls WHERE id=?').get(rollId) as {remaining_qty:number;qty_unit:string};
    const consumptionM = lengthM*layers;
    const reserved = (db.prepare(`SELECT COALESCE(SUM(matelas_length_cm*layers/100.0),0) metres FROM marker_plans WHERE roll_id=? AND status='valide' AND actual_json IS NULL AND id!=?`).get(rollId,plan.id) as {metres:number}).metres;
    if (roll.qty_unit!=='m' || roll.remaining_qty==null || consumptionM>roll.remaining_qty-reserved+1e-7) throw new ServiceError('Longueur réelle incompatible avec le stock restant et les autres réservations.',409);
    const task = createTask(actor,{lotId:plan.lotId,description:`Coupe réelle du plan MK-${plan.id}`,rollIds:[rollId],observations:reason});
    setTaskResults(actor,task.id,{results,reason,consumptions:[{rollId,weightUsed:weightKg}]});
    patchTask(actor,task.id,{action:'finish'});
    validateTask(actor,task.id,{notes:reason});
    db.prepare('UPDATE coupe_rolls SET remaining_qty=remaining_qty-?,updated_at=datetime(\'now\') WHERE id=?').run(consumptionM,rollId);
    db.prepare(`INSERT INTO coupe_roll_movements (roll_id,movement_type,lot_id,task_id,qty,unit,reason,user_id) VALUES (?,'consommation',?,?,?,'m',?,?)`).run(rollId,plan.lotId,task.id,consumptionM,reason,actor.id);
    for (const row of rows) db.prepare(`INSERT INTO coupe_component_results (plan_id,size_id,pattern_id,component,expected_qty,cut_qty,usable_qty) VALUES (?,?,?,?,?,?,?)`)
      .run(plan.id,row.sizeId,row.patternId,row.component,row.expectedQty,row.cutQty,row.usableQty);
    for (const [kind,quantity] of [['chute',reusableKg],['dechet',wasteKg]] as const) if (quantity>0) {
      db.prepare(`INSERT INTO coupe_waste (lot_id,roll_id,waste_type,qty,unit,reason,user_id) VALUES (?,?,?,?,'kg',?,?)`).run(plan.lotId,rollId,kind,quantity,`Mesure du plan MK-${plan.id} — ${reason??''}`,actor.id);
    }
    const actual = {lengthM,layers,weightKg,reusableKg,wasteKg,consumptionM,components:rows,garments:results,reason,recordedBy:actor.id,recordedAt:new Date().toISOString()};
    db.prepare('UPDATE marker_plans SET result_task_id=?,actual_json=? WHERE id=?').run(task.id,JSON.stringify(actual),plan.id);
    db.prepare("UPDATE coupe_lots SET status='en_cours',started_at=COALESCE(started_at,datetime('now')) WHERE id=? AND status='brouillon'").run(plan.lotId);
    addHistory(db,{action:'MARKER_ACTUAL_VALIDATED',entityType:'marker_plan',entityId:plan.id,actorId:actor.id,newValue:actual,reason});
    storeTicket(actor,{type:'suivi',lotId:plan.lotId,planId:plan.id,refOperation:`RESULTAT-MK-${plan.id}`,payload:{...actual,transferStatus:'à confirmer physiquement',received:false}});
    return getMarkerPlan(actor,plan.id);
  }).immediate();
}
