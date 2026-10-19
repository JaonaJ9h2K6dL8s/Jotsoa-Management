'use client';
import { useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { AtelierData } from '@/routes/coupe/atelier';

export default function PatternLibrary({data,busy,act}:{data:AtelierData;busy:boolean;act:(action:string,input?:unknown,id?:number)=>Promise<void>}) {
  const [ficheId,setFicheId]=useState('');
  const [sourceName,setSourceName]=useState('');
  const [content,setContent]=useState('');
  const [verified,setVerified]=useState(false);
  const [error,setError]=useState('');
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
  return <Stack spacing={2}>
    <Alert severity="warning">Aucun contour industriel n’est créé depuis une photo ou des mesures de vêtement. Les anciens contours de démonstration sont exclus des nouveaux plans.</Alert>
    <Typography variant="h6">Importer des contours vectoriels réels</Typography>
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
    {!data.revisions.length&&<Alert severity="info">Aucune révision traçable importée. Importez puis approuvez les vrais patrons de l’entreprise.</Alert>}
    {data.revisions.map((revision)=><Box key={revision.id} sx={{border:'1px solid',borderColor:'divider',borderRadius:2,p:2}}>
      <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography fontWeight={600}>{revision.modelName} · {revision.sizeNom} · {revision.fabricRef} · V{revision.version} — {revision.status}</Typography>
        {revision.status==='valide'?<Button disabled={busy} onClick={()=>void act('archive',undefined,revision.id)}>Archiver</Button>:revision.status!=='archive'&&<Button disabled={busy||!revision.scaleVerified} onClick={()=>void act('approve',undefined,revision.id)}>Approuver</Button>}
      </Stack>
      <Typography variant="caption">Source : {revision.sourceName} · fiche {revision.ficheId}, version {revision.ficheVersion} · {revision.scaleVerified?'échelle contrôlée':'échelle à vérifier'}</Typography>
      <Stack direction="row" spacing={1} sx={{overflowX:'auto',mt:1}}>{revision.pieces.map((piece)=><Box key={piece.id} sx={{minWidth:120,width:120,bgcolor:'#f4f7f8',p:1,borderRadius:1}}>
        <svg viewBox={`${Math.min(...piece.points.map(point=>point.x))-1} ${Math.min(...piece.points.map(point=>point.y))-1} ${piece.widthCm+2} ${piece.heightCm+2}`} width="100%" height="85" role="img" aria-label={piece.label}><polygon points={piece.points.map(point=>`${point.x},${point.y}`).join(' ')} fill="#abd4c9" stroke="#294851" strokeWidth={0.3}/></svg>
        <Typography variant="caption">{piece.label} × {piece.qty}<br/>{piece.component} · {piece.areaCm2.toFixed(1)} cm²</Typography>
      </Box>)}</Stack>
    </Box>)}
  </Stack>;
}
