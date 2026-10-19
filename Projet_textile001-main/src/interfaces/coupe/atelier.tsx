'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import type { AtelierData } from '@/routes/coupe/atelier';
import type { NestingInput, NestingResult } from '@/server/coupe/nesting';
import type { MarkerPlanRow } from '@/server/coupe/marker';
import PlanCanvas from './plan-canvas';
import PatternLibrary from './pattern-library';
import RollTechnical from './roll-technical';
import ActualForm from './actual-form';
import { downloadPlacementPdf, downloadPlacementPng } from '@/features/coupe/fiches/plan-placement';
import { buildFichePdf, ficheFileName } from '@/features/coupe/fiches/fiche-pdf';

async function request(body?:unknown,planId?:number) {
  const response=await fetch(`/api/coupe/atelier${planId?`?planId=${planId}`:''}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const payload=await response.json() as {item:unknown;message?:string};
  if (!response.ok) throw new Error(payload.message??'Opération refusée.');
  return payload.item;
}
export default function Atelier() {
  const [data,setData]=useState<AtelierData|null>(null);
  const [tab,setTab]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [lotId,setLotId]=useState('');
  const [rollId,setRollId]=useState('');
  const [model,setModel]=useState('');
  const [revisions,setRevisions]=useState<Record<number,number>>({});
  const [quantities,setQuantities]=useState<Record<number,number>>({});
  const [config,setConfig]=useState({tableId:'',length:'',layers:'1',gap:'0.5',margin:'0',start:'',end:'',defects:'[]'});
  const [result,setResult]=useState<NestingResult|null>(null);
  const [plan,setPlan]=useState<MarkerPlanRow|null>(null);
  const refresh=useCallback(async()=>setData(await request() as AtelierData),[]);
  useEffect(()=>{void refresh().catch((cause:Error)=>setError(cause.message));},[refresh]);
  function dirty(){setPlan(null);setResult(null);setNotice('');}
  async function act(action:string,input?:unknown,id?:number) {
    setBusy(true);setError('');setNotice('');
    try {
      const item=await request({action,input,id});
      if (action==='verify') {setResult(item as NestingResult);setPlan(null);setNotice('Données vérifiées. Contrôlez le plan, puis enregistrez le brouillon.');}
      else if (['save','validate','actual'].includes(action)) {setPlan(item as MarkerPlanRow);setResult((item as MarkerPlanRow).result);setNotice(action==='validate'?'Plan validé et ticket de coupe généré.':action==='actual'?'Résultats et composants enregistrés sans réception couture automatique.':'Brouillon enregistré.');}
      else setNotice('Opération enregistrée et tracée.');
      await refresh();
    } catch(cause) {setError(cause instanceof Error?cause.message:'Opération impossible.');}
    finally {setBusy(false);}
  }
  const lot=data?.lots.find((item)=>item.id===Number(lotId));
  const product=data?.products.find((item)=>item.id===lot?.productId);
  const roll=data?.rolls.find((item)=>item.id===Number(rollId));
  const compatible=data?.revisions.filter((item)=>item.status==='valide'&&item.productId===product?.id&&item.fabricRef===roll?.fabricRef)??[];
  const models=[...new Set(compatible.map((item)=>item.modelName))];
  const chosenModel=model||(models.length===1?models[0]:'');
  function input(optimize=true):NestingInput {
    if (!lot||!roll||!product) throw new Error('Sélectionnez un lot du catalogue et un rouleau compatible.');
    const sizes=Object.entries(quantities).map(([sizeId,qty])=>({sizeId:Number(sizeId),qty})).filter((size)=>size.qty>0);
    const revisionIds=sizes.map((size)=>{
      const candidates=compatible.filter((item)=>item.modelName===chosenModel&&item.sizeId===size.sizeId);
      const revision=candidates.find((item)=>item.id===revisions[size.sizeId])??(candidates.length===1?candidates[0]:null);
      if (!revision) throw new Error(`Taille ${product.sizes.find((item)=>item.id===size.sizeId)?.nom??size.sizeId} : choisissez une révision approuvée.`);
      return revision.id;
    });
    const constraints=JSON.parse(roll.constraintsJson) as {motif?:string};
    return {productId:product.id,category:product.category,lotId:lot.id,rollId:roll.id,modelName:chosenModel,fabricRef:roll.fabricRef,
      sizes,revisionIds,usableWidthCm:roll.usableWidthCm??0,grammageGm2:roll.grammageGm2,coupeTableId:Number(config.tableId),
      matelasLengthCm:Number(config.length),layers:Number(config.layers),gapCm:Number(config.gap),marginCm:Number(config.margin),
      plannedStart:config.start?new Date(config.start).toISOString():'',plannedEnd:config.end?new Date(config.end).toISOString():'',
      defects:JSON.parse(config.defects),oneWay:constraints.motif==='sens_unique',optimize};
  }
  function generate(action:string,optimize=true) {try {void act(action,input(optimize));} catch(cause){setError(cause instanceof Error?cause.message:'Données invalides.');}}
  async function load(id:number) {
    setBusy(true);setError('');
    try {const item=await request(undefined,id) as MarkerPlanRow;setPlan(item);setResult(item.result);setTab(0);}
    catch(cause){setError(cause instanceof Error?cause.message:'Lecture impossible.');}finally{setBusy(false);}
  }
  async function move(layout:NonNullable<NestingInput['manualLayout']>) {
    setBusy(true);setError('');
    try {
      if (plan) {const saved=await request({action:'move',id:plan.id,layout}) as MarkerPlanRow;setPlan(saved);setResult(saved.result);}
      else {const checked=await request({action:'verify',input:{...input(),manualLayout:layout}}) as NestingResult;setResult(checked);}
      await refresh();setNotice('Déplacement contrôlé : limites, défauts, orientations et chevauchements vérifiés.');
    } catch(cause){setError(cause instanceof Error?cause.message:'Déplacement refusé.');}finally{setBusy(false);}
  }
  if (!data) return <Stack spacing={2}>{error?<Alert severity="error">{error}</Alert>:<CircularProgress/>}<Button onClick={()=>void refresh().catch((cause:Error)=>setError(cause.message))}>Recharger</Button></Stack>;
  return <Stack spacing={2}>
    <Typography component="h1" variant="h5">Préparation de coupe · Patrons vérifiés</Typography>
    <Typography color="text.secondary">Fiches officielles → révisions approuvées → placement → validation → mesures réelles → transfert confirmé.</Typography>
    <Tabs value={tab} onChange={(_: React.SyntheticEvent,value:number)=>setTab(value)} variant="scrollable" scrollButtons="auto"><Tab label="Préparer la coupe"/><Tab label="Bibliothèque des patrons"/><Tab label="Tissu et rouleaux"/><Tab label="Plans enregistrés"/></Tabs>
    {error&&<Alert severity="error" onClose={()=>setError('')}>{error}</Alert>}{notice&&<Alert severity="success" onClose={()=>setNotice('')}>{notice}</Alert>}
    {busy&&<Typography variant="body2">Calcul ou enregistrement en cours…</Typography>}
    <Box component="fieldset" disabled={busy} sx={{border:0,p:0,m:0,minWidth:0}}>
      {tab===1&&<PatternLibrary data={data} busy={busy} act={act}/>}
      {tab===2&&<RollTechnical data={data} busy={busy} act={act}/>}
      {tab===3&&<Stack spacing={1}>{!data.plans.length&&<Alert severity="info">Aucun plan enregistré.</Alert>}{data.plans.map((item)=><Paper key={item.id} variant="outlined" sx={{p:2}}><Stack direction="row" spacing={2} alignItems="center"><Typography sx={{flex:1}}>MK-{item.id} · {item.productName} · {item.coupeTableNom??'table non précisée'} · {item.createdAt}</Typography><Chip label={item.status}/><Button onClick={()=>void load(item.id)}>Ouvrir cette version</Button></Stack></Paper>)}</Stack>}
      {tab===0&&<Stack spacing={2}>
        <Paper variant="outlined" sx={{p:2}}><Stack spacing={2}>
          <Typography variant="h6">1. Lot et matière</Typography>
          <Stack direction={{xs:'column',md:'row'}} spacing={2}>
            <TextField fullWidth select label="Lot de production existant" value={lotId} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setLotId(event.target.value);setRevisions({});setModel('');setRollId('');const next=data.lots.find((item)=>item.id===Number(event.target.value));setQuantities(Object.fromEntries(next?.sizes.map((size)=>[size.sizeId,Math.max(0,size.plannedQty-size.cutQty)])??[]));}}>
              {data.lots.filter((item)=>data.products.some((candidate)=>candidate.id===item.productId)).map((item)=><MenuItem key={item.id} value={item.id}>{item.code} · {data.products.find((candidate)=>candidate.id===item.productId)?.nom} · {item.colorNom}</MenuItem>)}
            </TextField>
            <TextField fullWidth select label="Rouleau (couleur du lot)" value={rollId} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setRollId(event.target.value);setRevisions({});setModel('');}}>{data.rolls.filter((item)=>item.colorId===lot?.colorId).map((item)=><MenuItem key={item.id} value={item.id}>{item.code} · {item.fabricRef}</MenuItem>)}</TextField>
            <TextField fullWidth select label="Modèle approuvé" value={chosenModel} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setModel(event.target.value);setRevisions({});}}>{models.map((name)=><MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>
          </Stack>
          {product&&<Typography variant="body2">Produit : {product.nom} · {product.category} · couleur : {lot?.colorNom}. {roll?`Largeur utile ${roll.usableWidthCm??'inconnue'} cm · ${roll.grammageGm2??'grammage inconnu'} g/m² · reste ${roll.unit==='m'?roll.remainingM:'non mesuré'} m.`:''}</Typography>}
          {lot&&roll&&!compatible.length&&<Alert severity="warning">Aucun patron approuvé pour ce produit et ce tissu. Importez les contours réels dans la bibliothèque ; les tailles voisines ne seront jamais substituées.</Alert>}
          {lot?.sizes.map((size)=>{
            const candidates=compatible.filter((item)=>item.modelName===chosenModel&&item.sizeId===size.sizeId);
            return <Stack direction={{xs:'column',sm:'row'}} spacing={2} key={size.sizeId}>
              <TextField size="small" type="number" label={`${size.sizeNom} — prévu ${size.plannedQty}, coupé ${size.cutQty}`} value={quantities[size.sizeId]??0} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setQuantities({...quantities,[size.sizeId]:Number(event.target.value)});}}/>
              <TextField size="small" select label="Révision exacte" sx={{minWidth:260}} value={revisions[size.sizeId]??(candidates.length===1?candidates[0].id:'')} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setRevisions({...revisions,[size.sizeId]:Number(event.target.value)});}}>{candidates.map((revision)=><MenuItem key={revision.id} value={revision.id}>V{revision.version} — {revision.sourceName}</MenuItem>)}</TextField>
            </Stack>;
          })}
          <Typography variant="h6">2. Matelas et créneau</Typography>
          <Stack direction={{xs:'column',md:'row'}} spacing={2}>
            <TextField fullWidth select label="Table indépendante" value={config.tableId} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setConfig({...config,tableId:event.target.value});}}>{data.tables.map((table)=><MenuItem key={table.id} value={table.id}>{table.nom} — {table.largeurUtileCm} × {table.longueurMaxCm} cm — {table.couchesMax} couches max.</MenuItem>)}</TextField>
            {([['length','Longueur matelas (cm)'],['layers','Couches'],['gap','Espacement (cm)'],['margin','Marge sécurité (cm)']] as const).map(([field,label])=><TextField key={field} fullWidth type="number" label={label} value={config[field]} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setConfig({...config,[field]:event.target.value});}}/>)}
          </Stack>
          <Stack direction={{xs:'column',sm:'row'}} spacing={2}>{(['start','end'] as const).map((field)=><TextField key={field} type="datetime-local" label={field==='start'?'Début de coupe':'Fin de coupe'} slotProps={{inputLabel:{shrink:true}}} value={config[field]} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setConfig({...config,[field]:event.target.value});}}/>)}</Stack>
          <TextField label="Zones interdites du matelas (cm, toutes couches) : [{x,y,widthCm,heightCm,label}]" multiline minRows={2} value={config.defects} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{dirty();setConfig({...config,defects:event.target.value});}}/>
          <Typography variant="caption">Le sens unique vient du rouleau. Les défauts longitudinaux du rouleau nécessitent une projection par couche ; cette opération n’est pas simulée. Les raccords de motifs/rayures non pris en charge bloquent la validation.</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap"><Button variant="outlined" onClick={()=>generate('verify',false)}>Vérifier les données / plan rapide</Button><Button variant="contained" onClick={()=>generate('verify',true)}>Générer / optimiser le placement</Button><Button disabled={!result||Boolean(plan)} onClick={()=>{try{void act('save',{...input(),manualLayout:result?.placements});}catch(cause){setError((cause as Error).message);}}}>Enregistrer le brouillon affiché</Button></Stack>
        </Stack></Paper>
        {result&&<Paper variant="outlined" sx={{p:2}}><Stack spacing={2}>
          <Stack direction="row" gap={1} flexWrap="wrap"><Chip label={`${result.totalPiecesAllLayers} pièces toutes couches`}/><Chip label={`${result.efficiency.toFixed(2)} % utilisation théorique`}/><Chip label={`${(result.availableAreaAllLayersM2??result.availableAreaM2*result.layers).toFixed(2)} m² disponibles`}/><Chip label={`${(result.unusedAreaAllLayersM2??result.wasteAreaM2*result.layers).toFixed(2)} m² non utilisés (pas des déchets déclarés)`}/>{result.consumptionKg!=null&&<Chip label={`${result.consumptionKg.toFixed(3)} kg théoriques`}/>}</Stack>
          {!plan?.input&&plan&&<Alert severity="warning">Plan historique sans provenance industrielle vérifiée. Consultable pour traçabilité, non réutilisable comme patron approuvé.</Alert>}
          <PlanCanvas key={plan?.id??'preview'} result={result} editable={!busy&&(!plan||Boolean(plan.input)&&plan.status!=='valide')} onMove={(layout)=>void move(layout)}/>
          {plan&&<Stack direction="row" gap={1} flexWrap="wrap"><Chip label={`MK-${plan.id} · ${plan.status}`}/><Button variant="contained" disabled={plan.status==='valide'||!plan.input||busy} onClick={()=>void act('validate',undefined,plan.id)}>Valider ce plan</Button><Button disabled={plan.status!=='valide'} onClick={()=>downloadPlacementPdf(plan)}>Télécharger le plan PDF</Button><Button disabled={plan.status!=='valide'} onClick={()=>downloadPlacementPng(plan)}>Télécharger l’image</Button>
            {plan.status==='valide'&&plan.result?.fiches?.map((fiche)=><Button key={`${fiche.id}:${fiche.version}`} onClick={()=>buildFichePdf(fiche,false,plan).save(ficheFileName(fiche))}>Fiche figée {fiche.sizeNom} V{fiche.version}</Button>)}
          </Stack>}
        </Stack></Paper>}
        {plan?.status==='valide'&&plan.input&&<Paper variant="outlined" sx={{p:2}}><Typography variant="h6" mb={2}>3. Résultats réellement mesurés</Typography><ActualForm key={plan.id} plan={plan} busy={busy} act={act}/>{plan.lotId&&<Button href={`/coupe/lots/${plan.lotId}`}>Contrôler le lot et confirmer le transfert physique</Button>}<Button href="/coupe/tickets">Consulter / imprimer / réimprimer les tickets QR</Button></Paper>}
      </Stack>}
    </Box>
  </Stack>;
}
