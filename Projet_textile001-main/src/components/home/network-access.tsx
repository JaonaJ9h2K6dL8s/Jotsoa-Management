import Box from '@mui/material/Box';
import { networkInterfaces } from 'node:os';

/**
 * Adresse réseau du serveur affichée sur la page d'accueil :
 * indique aux autres postes de l'atelier quelle URL ouvrir
 * (http://IP-du-serveur:3000). Composant serveur pur.
 */
function serverLanAddresses(): string[] {
  const result: string[] = [];
  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (
        address.family === 'IPv4' &&
        !address.internal &&
        !result.includes(address.address)
      ) {
        result.push(address.address);
      }
    }
  }
  return result;
}

export default function NetworkAccess() {
  const addresses = serverLanAddresses();
  if (addresses.length === 0) return null;

  return (
    <Box
      sx={{
        mt: 2.5,
        textAlign: 'center',
        fontSize: 12,
        color: '#9fb0d4',
        lineHeight: 1.8,
      }}
    >
      {addresses.map((address) => (
        <span
          key={address}
          style={{
            display: 'inline-block',
            padding: '3px 12px',
            margin: '0 4px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)',
            fontFamily: 'Consolas, monospace',
            color: '#c9d6f0',
          }}
        >
          {`http://${address}:3000`}
        </span>
      ))}
      <span style={{ display: 'block', marginTop: 4 }}>
        Adresse réseau du serveur — à ouvrir depuis un autre poste
      </span>
    </Box>
  );
}
