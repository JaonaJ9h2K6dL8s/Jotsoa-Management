'use client';

import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useEffect, useState } from 'react';
import { ROLE_CODES, ROLE_LABELS, type RoleCode } from '@/lib/roles';
import { validateNom, validateUsername } from '@/lib/validation';
import type { ManagedUser } from '@/types/auth';

/**
 * Boîte de dialogue de création / modification d'un utilisateur.
 * Le mot de passe n'est demandé qu'à la création et n'est jamais réaffiché.
 */

export interface UserFormData {
  nom: string;
  prenom: string;
  username: string;
  password: string;
  roleCode: RoleCode;
}

interface Props {
  open: boolean;
  user: ManagedUser | null;
  onClose: () => void;
  onSubmit: (data: UserFormData) => Promise<void>;
}

const EMPTY: UserFormData = {
  nom: '',
  prenom: '',
  username: '',
  password: '',
  roleCode: 'chef_coupe',
};

export default function UserFormDialog({ open, user, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<UserFormData>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        user
          ? {
              nom: user.nom,
              prenom: user.prenom ?? '',
              username: user.username,
              password: '',
              roleCode: user.roleCode,
            }
          : EMPTY,
      );
      setError(null);
    }
  }, [open, user]);

  function setField<K extends keyof UserFormData>(key: K, value: UserFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    const nomError = validateNom(form.nom);
    const usernameError = validateUsername(form.username);
    if (nomError || usernameError) {
      setError(nomError ?? usernameError);
      return;
    }
    if (!user && form.password.length === 0) {
      setError('Le mot de passe initial est requis.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Erreur lors de l’enregistrement.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {user ? `Modifier ${user.username}` : 'Nouvel utilisateur'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-1">
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <TextField
            label="Nom"
            value={form.nom}
            onChange={(event) => setField('nom', event.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Prénom (facultatif)"
            value={form.prenom}
            onChange={(event) => setField('prenom', event.target.value)}
            fullWidth
          />
          <TextField
            label="Identifiant"
            value={form.username}
            onChange={(event) => setField('username', event.target.value)}
            required
            fullWidth
            helperText="3 à 40 caractères : lettres, chiffres, . _ -"
          />
          {user ? null : (
            <TextField
              label="Mot de passe initial"
              type="password"
              value={form.password}
              onChange={(event) => setField('password', event.target.value)}
              required
              fullWidth
              helperText="8 caractères minimum, avec lettres et chiffres. Un changement sera exigé à la première connexion."
            />
          )}
          <TextField
            select
            label="Rôle"
            value={form.roleCode}
            onChange={(event) => setField('roleCode', event.target.value as RoleCode)}
            fullWidth
          >
            {ROLE_CODES.map((code) => (
              <MenuItem key={code} value={code}>
                {ROLE_LABELS[code]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Annuler
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
