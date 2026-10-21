'use client';
import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { AtelierData } from '@/routes/coupe/atelier';
import type { GenerateResult } from '@/server/coupe/pattern-generator';

const GRAIN_LABELS:Record<string,string>={along:'droit-fil longitudinal',cross:'droit-fil transversal',any:'droit-fil libre'};

export default function PatternLibrary({data,busy,act}:{data:AtelierData;busy:boolean;act:(action:string,input?:unknown,id?:number)=>Promise<unknown>}) {
  const [ficheId,setFicheId]=useState('');
  const [sourceName,setSourceName]=useState('');
  const [content,setContent]=useState('');
  const [verified,setVerified]=useState(false);
  const [error,setError]=useState('');
  const [genFicheId,setGenFicheId]=useState('');
  const [genAllowance,setGenAllowance]=useState('');
  const [generated,setGenerated]=useState<GenerateResult|null>(null);
  async function load(file?:File) {
    if (!file) return;
    if (file.size>2000000) {setError('Fichier supérieur à 2 Mo.');return;}
    setContent(await file.text());setSourceName(file.name);setVerified(false);setError('');
  }
  async function submit() {
    try {
      const parsed=JSON.parse(content) as Record<string,unknown>;
      await act('import',{...parsed,ficheId:Number(ficheId),sourceName,scaleVerified:verified});
    } catch(cause) {setError(cause instanceof Error?cause.message:'Import invalide.');}
  }
  async function generate() {
    setGenerated(null);
    await act('generate',{ficheId:Number(genFicheId),...(genAllowance===''?{}:{seamAllowanceCm:Number(genAllowance)})});
  }
  // Génération : uniquement des fiches validées rattachées à une taille.
  const genFiche=data.fiches.find((fiche)=>fiche.id===Number(genFicheId)&&fiche.statut==='valide'&&fiche.sizeId);
  const genProduct=data.products.find((product)=>product.id===genFiche?.productId);
  const missing=genFiche&&genProduct?genProduct.measurements.filter((label)=>!genFiche.mesures.some((m)=>m.label===label&&m.valeurCm>0)):[];
  function piecesView(pieces:typeof data.revisions[number]['pieces']) {
    const components=[...new Set(pieces.map((piece)=>piece.component))];
    return components.map((component)=>(<Box key={component}>
      {components.length>1&&<Typography variant="subtitle2" sx={{mt:1}}>{component==='haut'?'Haut de l’ensemble':component==='short'?'Short de l’ensemble':'Pièces principales'}</Typography>}
      <Stack direction="row" spacing={1} sx={{overflowX:'auto',mt:1}}>{pieces.filter((piece)=>piece.component===component).map((piece)=><Box key={piece.id} sx={{minWidth:130,width:130,bgcolor:'#f4f7f8',p:1,borderRadius:1}}>
        <svg viewBox={`${Math.min(...piece.points.map(point=>point.x))-1} ${Math.min(...piece.points.map(point=>point.y))-1} ${piece.widthCm+2} ${piece.heightCm+2}`} width="100%" height="85" role="img" aria-label={piece.label}><polygon points={piece.points.map(point=>`${point.x},${point.y}`).join(' ')} fill="#abd4c9" stroke="#294851" strokeWidth={0.3}/><line x1={piece.widthCm/2} y1={Math.min(...piece.points.map(point=>point.y))+0.4} x2={piece.widthCm/2} y2={Math.min(...piece.points.map(point=>point.y))+piece.heightCm-0.4} stroke="#b3543f" strokeWidth={0.15} strokeDasharray="0.8 0.4"/><polygon points={`${piece.widthCm/2-0.25},${Math.min(...piece.points.map(point=>point.y))+1.1} ${piece.widthCm/2+0.25},${Math.min(...piece.points.map(point=>point.y))+1.1} ${piece.widthCm/2},${Math.min(...piece.points.map(point=>point.y))+0.5}`} fill="#b3543f"/></svg>
        <Typography variant="caption">{piece.label} × {piece.qty}<br/>{piece.widthCm.toFixed(1)} × {piece.heightCm.toFixed(1)} cm · {piece.areaCm2.toFixed(1)} cm²<br/>{GRAIN_LABELS[piece.grain]??piece.grain} · {piece.seamIncluded?'coutures intégrées':'coutures à ajouter'}</Typography>
      </Box>)}</Stack>
    </Box>));
  }
  return <Stack spacing={2}>
    <Typography variant="h6">Générer les patrons depuis une fiche validée</Typography>
    <Alert severity="info">La génération crée une révision en brouillon à partir des mesures officielles validées de la fiche et des règles de patronage versionnées. Examinez les contours puis approuvez la révision : aucune validation automatique, et les révisions antérieures restent intactes.</Alert>
    <TextField select label="Fiche technique validée (produit, modèle, taille)" value={genFicheId} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{setGenFicheId(event.target.value);setGenerated(null);}}>
      {data.fiches.filter((fiche)=>fiche.statut==='valide'&&fiche.sizeId).map((fiche)=><MenuItem value={fiche.id} key={fiche.id}>{fiche.productNom} · {fiche.modele??'modèle manquant'} · {fiche.sizeNom} · V{fiche.version}</MenuItem>)}
    </TextField>
    {genFiche&&genProduct&&<Box sx={{border:'1px solid',borderColor:'divider',borderRadius:2,p:2}}>
      <Typography variant="body2">Produit : {genProduct.nom} · famille {genProduct.family} · {genProduct.category} · taille {genFiche.sizeNom}. Mesures validées : {genFiche.mesures.map((m)=>`${m.label} ${m.valeurCm} cm`).join(' · ')}.</Typography>
      {genProduct.family==='polo'&&<Alert severity="warning" sx={{mt:1}}>Patronage polo indisponible : la hauteur de col n’est pas définie dans le catalogue. Ajoutez cette mesure officielle avant toute génération ; aucune pièce ne sera inventée.</Alert>}
      {Boolean(missing.length)&&<Alert severity="warning" sx={{mt:1}}>Mesures officielles manquantes : {missing.join(', ')}. Complétez la fiche avant la génération.</Alert>}
      <Stack direction={{xs:'column',sm:'row'}} spacing={2} sx={{mt:2}}>
        <TextField size="small" type="number" label="Marge de couture (cm) — vide : valeur de la fiche" value={genAllowance} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setGenAllowance(event.target.value)} slotProps={{htmlInput:{min:0,max:10,step:0.1}}}/>
        <Button variant="contained" disabled={busy||!genFicheId} onClick={()=>void generate()}>Générer la révision brouillon</Button>
      </Stack>
    </Box>}
    {generated&&<Box sx={{border:'1px solid',borderColor:'success.main',borderRadius:2,p:2}}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Chip color="warning" size="small" label={`Révision #${generated.revisionId} · V${generated.version} · ${generated.status}`}/><Chip size="small" label={`Règles ${generated.rulesVersion}`}/><Chip size="small" label={`Source ${generated.sourceName}`}/><Chip size="small" label={`Marge ${generated.seamAllowanceCm} cm`}/></Stack>
      <Typography variant="body2" sx={{mt:1}}>{generated.notice}</Typography>
      {piecesView(data.revisions.find((revision)=>revision.id===generated.revisionId)?.pieces??[])}
    </Box>}
    <Typography variant="h6">Importer des contours vectoriels réels</Typography>
    <Alert severity="warning">Aucun contour industriel n’est créé depuis une photo ou des mesures de vêtement. Les anciens contours de démonstration sont exclus des nouveaux plans.</Alert>
    <TextField select label="Fiche, modèle et taille associés" value={ficheId} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setFicheId(event.target.value)}>
      {data.fiches.map((fiche)=><MenuItem value={fiche.id} key={fiche.id}>{fiche.productNom} · {fiche.modele??'modèle manquant'} · {fiche.sizeNom} · V{fiche.version} · {fiche.statut}</MenuItem>)}
    </TextField>
    <Stack direction="row" spacing={1}><Button component="label" variant="outlined">Choisir un fichier JSON vectoriel<input type="file" accept=".json,application/json" hidden onChange={(event: React.ChangeEvent<HTMLInputElement>)=>void load(event.target.files?.[0])}/></Button><Button href="/coupe/fiches">Saisir / valider les mesures officielles</Button></Stack>
    <TextField label="Référence du fichier source" value={sourceName} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setSourceName(event.target.value)}/>
    <TextField multiline minRows={5} maxRows={14} label="Contours exportés du logiciel de patronage (JSON)" value={content} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{setContent(event.target.value);setVerified(false);}}/>
    <Typography variant="body2">Format : unité « cm » ou « mm », puis tableau « pieces ». Chaque pièce fournit code, label, role (devant, dos, manche, col, patte, ceinture, poche…), component (principal ; haut ou short pour un ensemble), points [[x,y],…], width, height, qty, grain (along/cross/any), rotations, seamAllowanceCm, seamIncluded et marks facultatifs [[x,y],…]. Largeur et hauteur de contrôle sont exprimées dans l’unité source. Les courbes doivent être exportées en contours polygonaux contrôlés ; SVG/CAO natif n’est pas interprété automatiquement.</Typography>
    <FormControlLabel control={<Checkbox checked={verified} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setVerified(event.target.checked)}/>} label="J’ai contrôlé l’unité, l’échelle réelle, les dimensions et les valeurs de couture dans le fichier source."/>
    {error&&<Alert severity="error">{error}</Alert>}
    <Button variant="contained" disabled={busy||!ficheId||!content||!sourceName} onClick={()=>void submit()}>Importer une nouvelle version brouillon</Button>
    <Typography variant="h6">Bibliothèque — versions conservées</Typography>
    {!data.revisions.length&&<Alert severity="info">Aucune révision traçable. Générez depuis une fiche validée ou importez les vrais patrons de l’entreprise.</Alert>}
    {data.revisions.map((revision)=><Box key={revision.id} sx={{border:'1px solid',borderColor:'divider',borderRadius:2,p:2}}>
      <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography fontWeight={600}>{revision.modelName} · {revision.sizeNom} · {revision.fabricRef} · V{revision.version} — {revision.status}</Typography>
        {revision.status==='valide'?<Button disabled={busy} onClick={()=>void act('archive',undefined,revision.id)}>Archiver</Button>:revision.status!=='archive'&&<Button disabled={busy||!revision.scaleVerified} onClick={()=>void act('approve',undefined,revision.id)}>Approuver</Button>}
      </Stack>
      <Typography variant="caption">Source : {revision.sourceName} · fiche {revision.ficheId}, version {revision.ficheVersion} · {revision.scaleVerified?'échelle contrôlée':'échelle à vérifier'}</Typography>
      {piecesView(revision.pieces)}
    </Box>)}
  </Stack>;
}
