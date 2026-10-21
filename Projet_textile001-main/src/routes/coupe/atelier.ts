import { NextResponse } from 'next/server';
import { sessionsDb } from '@/server/auth/sessions';
import { technicalCatalogue } from '@/server/coupe/technical-catalogue';
import { listRevisions, importRevision, validateRevision, archiveRevision } from '@/server/coupe/pattern-library';
import { generatePatterns } from '@/server/coupe/pattern-generator';
import { listFiches } from '@/server/coupe/fiches';
import { createMarkerPlan, listMarkerPlans, getMarkerPlan, listCoupeTables, moveMarkerPieces, validateMarkerPlan } from '@/server/coupe/marker';
import { computeMarker, type NestingInput } from '@/server/coupe/nesting';
import { configureRoll, resourceFingerprint } from '@/server/coupe/plan-resources';
import { recordPlanActual } from '@/server/coupe/plan-actual';
import { requireCoupeGuard, rejectCrossOrigin, errorResponse } from '@/server/coupe/route-helpers';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

function bootstrap(actor:Actor) {
  const db = sessionsDb();
  const lots = db.prepare(`SELECT l.id,l.code,l.product_id productId,l.color_id colorId,c.nom colorNom,l.status FROM coupe_lots l
    JOIN colors c ON c.id=l.color_id WHERE l.status NOT IN ('transfere','annule') ORDER BY l.id DESC`).all() as Array<{id:number;code:string;productId:number;colorId:number;colorNom:string;status:string}>;
  const rolls = db.prepare(`SELECT id,code,fabric_ref fabricRef,color_id colorId,width_cm widthCm,usable_width_cm usableWidthCm,grammage_g_m2 grammageGm2,
    remaining_qty remainingM,qty_unit unit,fabric_lot fabricLot,constraints_json constraintsJson FROM coupe_rolls WHERE status IN ('disponible','en_utilisation') ORDER BY id DESC`).all() as Array<{
      id:number;code:string;fabricRef:string;colorId:number;widthCm:number|null;usableWidthCm:number|null;grammageGm2:number|null;remainingM:number|null;unit:string|null;fabricLot:string|null;constraintsJson:string;
    }>;
  return {products:technicalCatalogue(actor),revisions:listRevisions(actor),fiches:listFiches(actor),tables:listCoupeTables(actor),plans:listMarkerPlans(actor),rolls,
    lots:lots.map((lot)=>({...lot,sizes:db.prepare(`SELECT ls.size_id sizeId,s.nom sizeNom,ls.planned_qty plannedQty,
      COALESCE((SELECT SUM(cut_qty) FROM coupe_results WHERE lot_id=ls.lot_id AND size_id=ls.size_id),0) cutQty
      FROM coupe_lot_sizes ls JOIN sizes s ON s.id=ls.size_id WHERE ls.lot_id=? ORDER BY s.display_order`).all(lot.id) as Array<{sizeId:number;sizeNom:string;plannedQty:number;cutQty:number}>}))};
}
export type AtelierData = ReturnType<typeof bootstrap>;
export async function GET(request:Request) {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const id = new URL(request.url).searchParams.get('planId');
    return NextResponse.json({status:'ok',item:id?getMarkerPlan(guard.actor,Number(id)):bootstrap(guard.actor)},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return errorResponse(error,'Chargement de la préparation impossible.');}
}
export async function POST(request:Request) {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const text = await request.text();
    if (text.length>2000000) throw new ServiceError('Import trop volumineux (2 Mo maximum).',413);
    const body = JSON.parse(text) as Record<string,unknown>;
    if (!body || typeof body!=='object' || Array.isArray(body)) throw new ServiceError('Objet JSON attendu.',400);
    const input = body.input as Record<string,unknown>;
    let item:unknown;
    switch(body.action) {
      case 'import': item=importRevision(guard.actor,input);break;
      case 'generate': item=generatePatterns(guard.actor,input as {ficheId:unknown;seamAllowanceCm?:unknown});break;
      case 'approve': item=validateRevision(guard.actor,body.id);break;
      case 'archive': archiveRevision(guard.actor,body.id);break;
      case 'roll': configureRoll(guard.actor,input);break;
      case 'verify': {
        const result=computeMarker(guard.actor,input as unknown as NestingInput);
        resourceFingerprint(guard.actor,input as unknown as NestingInput,result);
        item=result;break;
      }
      case 'save': item=createMarkerPlan(guard.actor,input as unknown as NestingInput);break;
      case 'validate': item=validateMarkerPlan(guard.actor,Number(body.id));break;
      case 'move': item=moveMarkerPieces(guard.actor,Number(body.id),body.layout as NestingInput['manualLayout']);break;
      case 'actual': item=recordPlanActual(guard.actor,Number(body.id),input);break;
      default: throw new ServiceError('Action de préparation inconnue.',400);
    }
    return NextResponse.json({status:'ok',item});
  } catch(error) {return errorResponse(error instanceof SyntaxError?new ServiceError('JSON invalide.',400):error,'Opération refusée.');}
}
