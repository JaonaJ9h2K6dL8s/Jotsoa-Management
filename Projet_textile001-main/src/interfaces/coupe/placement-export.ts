import { jsPDF } from 'jspdf';
import type { MarkerPlanRow } from '@/server/coupe/marker';
import { labelAnchor, pointInside, type Point } from '@/lib/coupe-geometry';

export type PlacementPlan=MarkerPlanRow;
const colors=['#65b9b0','#efc562','#a2d2bf','#117b91','#c7b6dc','#eda68e'];
export function placementFileName(plan:PlacementPlan,extension:string):string {
  return `PLAN_PLACEMENT_${plan.productName.replace(/[^\p{L}\p{N}_-]/gu,'_')}_MK${plan.id}.${extension}`;
}
export function placementCaption(plan:PlacementPlan) {
  return {produit:plan.productName,table:plan.coupeTableNom??'Non renseignée',
    matelas:`${plan.matelasLengthCm} cm × ${plan.usableWidthCm} cm (largeur utile)`,couches:String(plan.layers),
    tailles:plan.sizes.map((size)=>`${plan.result?.patternPieces.find((piece)=>piece.sizeId===size.sizeId)?.sizeNom??`ID ${size.sizeId}`} : ${size.qty}`).join(', '),
    efficacite:`${plan.efficiency.toFixed(2)} %`,version:`MK-${plan.id} — ${plan.validatedAt?`validé le ${plan.validatedAt}`:plan.status==='valide'?'historique, date de validation inconnue':'brouillon'}`};
}
interface Shape {points:Point[];fill:string;label?:string;anchor?:Point;arrow?:[Point,Point];legend?:string}
function scene(plan:PlacementPlan):Shape[] {
  const length=plan.matelasLengthCm;
  const sizes=[...new Set(plan.result?.placements.map((piece)=>piece.sizeId)??[])];
  const map=(point:Point)=>({x:length-point.y,y:point.x});
  const shapes:Shape[]=[{points:[{x:0,y:0},{x:length,y:0},{x:length,y:plan.usableWidthCm},{x:0,y:plan.usableWidthCm}],fill:'#fff2e7'}];
  for (const zone of plan.result?.defects??[]) shapes.push({points:[{x:length-zone.y-zone.heightCm,y:zone.x},{x:length-zone.y,y:zone.x},
    {x:length-zone.y,y:zone.x+zone.widthCm},{x:length-zone.y-zone.heightCm,y:zone.x+zone.widthCm}],fill:'#ef9999'});
  plan.result?.placements.forEach((placement,index)=>{
    const anchor=labelAnchor(placement.points);
    const pattern=plan.result?.patternPieces.find((piece)=>piece.id===placement.patternId);
    let arrow:Shape['arrow'];
    if (pattern&&pattern.grainDirection!=='any') {
      const radians=placement.rotation*Math.PI/180;
      const nativeX=pattern.grainDirection==='cross'?1:0;
      const nativeY=pattern.grainDirection==='cross'?0:1;
      const directionX=nativeX*Math.cos(radians)-nativeY*Math.sin(radians);
      const directionY=nativeX*Math.sin(radians)+nativeY*Math.cos(radians);
      let half=Math.min(placement.widthCm,placement.heightCm)*0.15;
      for (let attempt=0;attempt<6;attempt+=1) {
        const start={x:anchor.x-directionX*half,y:anchor.y-directionY*half};
        const end={x:anchor.x+directionX*half,y:anchor.y+directionY*half};
        if (Array.from({length:9},(_,step)=>({x:start.x+(end.x-start.x)*step/8,y:start.y+(end.y-start.y)*step/8})).every((point)=>pointInside(point,placement.points))) {arrow=[map(start),map(end)];break;}
        half/=2;
      }
    }
    shapes.push({points:placement.points.map(map),fill:colors[sizes.indexOf(placement.sizeId)%colors.length],label:String(index+1),anchor:map(anchor),arrow,
      legend:`${index+1}. ${placement.pieceLabel} · ${placement.sizeNom} · ${pattern?.component??'composant historique'} · ${placement.rotation}° · ${pattern?.version??'version inconnue'}`});
  });
  return shapes;
}
function frame(plan:PlacementPlan,x:number,y:number,width:number,height:number) {
  const scale=Math.min((width-14)/plan.matelasLengthCm,(height-14)/plan.usableWidthCm);
  return {scale,origin:{x:x+12,y:y+12},map:(point:Point)=>({x:x+12+point.x*scale,y:y+12+point.y*scale})};
}
export function drawPlacementIntoDoc(doc:jsPDF,plan:PlacementPlan,x:number,y:number,width:number,height:number):void {
  if (!plan.result?.placements.length) {doc.text('Plan de placement non disponible',x,y+5);return;}
  const view=frame(plan,x,y,width,height);
  for (const shape of scene(plan)) {
    const points=shape.points.map(view.map);
    doc.setDrawColor('#34454e');doc.setFillColor(shape.fill);doc.setLineWidth(0.2);
    doc.lines(points.slice(1).map((point,index)=>[point.x-points[index].x,point.y-points[index].y]),points[0].x,points[0].y,[1,1],'FD',true);
    if (shape.arrow) {
      const [start,end]=shape.arrow.map(view.map);
      doc.line(start.x,start.y,end.x,end.y);
      const angle=Math.atan2(end.y-start.y,end.x-start.x);
      doc.line(end.x,end.y,end.x-Math.cos(angle-0.5),end.y-Math.sin(angle-0.5));
      doc.line(end.x,end.y,end.x-Math.cos(angle+0.5),end.y-Math.sin(angle+0.5));
    }
    if (shape.anchor&&shape.label) {
      const anchor=view.map(shape.anchor);doc.setFontSize(6);doc.setTextColor(20);doc.text(shape.label,anchor.x,anchor.y-0.8,{align:'center'});
    }
  }
  const margin=plan.result.marginCm??0;
  if (margin>0) {
    doc.setDrawColor('#a46b21');doc.setLineDashPattern([1,1],0);
    doc.rect(view.origin.x+margin*view.scale,view.origin.y+margin*view.scale,(plan.matelasLengthCm-2*margin)*view.scale,(plan.usableWidthCm-2*margin)*view.scale);
    doc.setLineDashPattern([],0);
  }
  doc.setTextColor('#166b93');doc.setFontSize(8);
  doc.text(`${plan.matelasLengthCm} cm`,view.origin.x+plan.matelasLengthCm*view.scale/2,view.origin.y-3,{align:'center'});
  doc.text(`${plan.usableWidthCm} cm`,view.origin.x-4,view.origin.y+plan.usableWidthCm*view.scale/2,{angle:90,align:'center'});
  doc.setTextColor(25);
}
export function buildPlacementPdf(plan:PlacementPlan):jsPDF {
  const doc=new jsPDF({format:'a4',orientation:'landscape'});
  const cap=placementCaption(plan);
  doc.setFontSize(12);doc.text('PLAN DE PLACEMENT DES PATRONS SUR LA TABLE DE COUPE',14,14);
  doc.setFontSize(9);doc.text(`${cap.produit} · ${cap.version}`,14,21);
  drawPlacementIntoDoc(doc,plan,12,24,273,116);
  const rows=[`Table : ${cap.table} · Lot : ${plan.lotId??'non renseigné'} · ${cap.matelas} · ${cap.couches} couches`,
    `Tailles / vêtements : ${cap.tailles}`,`Utilisation théorique : ${cap.efficacite} · Méthode : ${plan.result?.method??'historique'}`,
    `Rouleau : ${plan.input?.rollId??'non renseigné'} · Révisions : ${plan.result?.revisionIds?.join(', ')??'provenance non vérifiée'}`];
  let cursor=148;
  doc.setFontSize(8.5);
  for (const row of rows) {const lines=doc.splitTextToSize(row,265) as string[];doc.text(lines,14,cursor);cursor+=lines.length*4.5+2;}
  doc.setFontSize(7.5);doc.text('Vue proportionnelle. Échelle non contractuelle : ne pas utiliser comme patron de coupe à taille réelle.',14,199);
  const legends=scene(plan).filter((shape)=>shape.legend);
  if (legends.length) {
    doc.addPage();cursor=20;doc.setFontSize(11);doc.text('Repérage des pièces — coordonnées du plan enregistré',14,12);
    legends.forEach((shape,index)=>{
      if (cursor>190) {doc.addPage();cursor=20;}
      const placement=plan.result!.placements[index];
      doc.setFontSize(8.5);
      const lines=doc.splitTextToSize(`${shape.legend} | x=${placement.x.toFixed(2)} cm ; y=${placement.y.toFixed(2)} cm`,265) as string[];
      doc.text(lines,14,cursor);cursor+=lines.length*4+2;
    });
  }
  return doc;
}
export function downloadPlacementPdf(plan:PlacementPlan):void {buildPlacementPdf(plan).save(placementFileName(plan,'pdf'));}
export function drawPlacementOnCanvas(canvas:HTMLCanvasElement,plan:PlacementPlan):void {
  const context=canvas.getContext('2d');if (!context) throw new Error('Canvas indisponible.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
  const scale=Math.min((canvas.width-90)/plan.matelasLengthCm,(canvas.height-150)/plan.usableWidthCm);
  const map=(point:Point)=>({x:60+point.x*scale,y:55+point.y*scale});
  for (const shape of scene(plan)) {
    context.beginPath();shape.points.map(map).forEach((point,index)=>index?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));context.closePath();
    context.fillStyle=shape.fill;context.fill();context.strokeStyle='#34454e';context.lineWidth=1.2;context.stroke();
    if (shape.arrow) {const [start,end]=shape.arrow.map(map);context.beginPath();context.moveTo(start.x,start.y);context.lineTo(end.x,end.y);context.stroke();
      const angle=Math.atan2(end.y-start.y,end.x-start.x);context.beginPath();context.moveTo(end.x,end.y);context.lineTo(end.x-5*Math.cos(angle-0.5),end.y-5*Math.sin(angle-0.5));context.moveTo(end.x,end.y);context.lineTo(end.x-5*Math.cos(angle+0.5),end.y-5*Math.sin(angle+0.5));context.stroke();}
    if (shape.anchor&&shape.label) {const point=map(shape.anchor);context.fillStyle='#142c37';context.font='12px sans-serif';context.textAlign='center';context.fillText(shape.label,point.x,point.y-3);}
  }
  const cap=placementCaption(plan);context.textAlign='left';context.fillStyle='#142c37';context.font='16px sans-serif';
  context.fillText(`${cap.produit} · MK-${plan.id} · ${cap.matelas} · ${cap.couches} couches`,60,25);
  context.font='13px sans-serif';context.fillText(`Tailles : ${cap.tailles} · utilisation théorique ${cap.efficacite}`,60,canvas.height-48);
  context.fillText('Plan proportionnel, échelle non contractuelle. Numéros des pièces : voir le PDF du même plan.',60,canvas.height-22);
}
export function renderPlacementCanvas(plan:PlacementPlan,widthPx=2200):HTMLCanvasElement {
  const canvas=document.createElement('canvas');canvas.width=Math.min(4096,Math.max(600,widthPx));
  canvas.height=Math.min(4096,Math.max(400,Math.round((canvas.width-90)*plan.usableWidthCm/plan.matelasLengthCm+150)));
  drawPlacementOnCanvas(canvas,plan);return canvas;
}
export function downloadPlacementPng(plan:PlacementPlan):void {
  renderPlacementCanvas(plan).toBlob((blob)=>{
    if (!blob) return;
    const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=placementFileName(plan,'png');anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
}
