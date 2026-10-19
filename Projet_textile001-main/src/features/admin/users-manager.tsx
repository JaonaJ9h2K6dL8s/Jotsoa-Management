'use client';

import Add from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useCallback, useEffect, useState } from 'react';
import { ROLE_CODES, ROLE_LABELS } from '@/lib/roles';
import { apiGet, apiPatch, apiPost } from '@/services/api-client';
import type { ManagedUser, UsersListResponse } from '@/types/auth';
import UserActionsMenu from './user-actions-menu';
import UserFormDialog, { type UserFormData } from './user-form-dialog';

/**
 * Gestion des utilisateurs (réservée à l'administrateur).
 * Toutes les opérations passent par des API vérifiées côté serveur.
 */

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function UsersManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const result = await apiGet<UsersListResponse>(
        `/api/admin/users?${params.toString()}`,
      );
      setUsers(result.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function handleFormSubmit(data: UserFormData) {
    if (editing) {
      await apiPatch(`/api/admin/users/${editing.id}`, {
        nom: data.nom,
        prenom: data.prenom || null,
        username: data.username,
        roleCode: data.roleCode,
      });
      setInfo('Utilisateur modifié.');
    } else {
      await apiPost('/api/admin/users', { ...data });
      setInfo('Utilisateur créé. Un changement de mot de passe sera exigé.');
    }
    await refresh();
  }

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Rechercher (identifiant, nom)"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="flex-1"
          size="small"
        />
        <FormControl size="small" className="min-w-40">
          <InputLabel>Rôle</InputLabel>
          <Select
            value={roleFilter}
            label="Rôle"
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <MenuItem value="all">Tous les rôles</MenuItem>
            {ROLE_CODES.map((code) => (
              <MenuItem key={code} value={code}>
                {ROLE_LABELS[code]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" className="min-w-40">
          <InputLabel>Statut</InputLabel>
          <Select
            value={statusFilter}
            label="Statut"
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <MenuItem value="all">Tous</MenuItem>
            <MenuItem value="active">Actifs</MenuItem>
            <MenuItem value="inactive">Désactivés</MenuItem>
          </Select>
        </FormControl>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nouvel utilisateur
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nom</TableCell>
              <TableCell>Identifiant</TableCell>
              <TableCell>Rôle</TableCell>
              <TableCell>Statut</TableCell>
              <TableCell>Créé le</TableCell>
              <TableCell>Dernière connexion</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center">
                  Aucun utilisateur trouvé.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.prenom ? `${user.prenom} ${user.nom}` : user.nom}
                  </TableCell>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>{user.roleLabel}</TableCell>
                  <TableCell>
                    <Chip
                      label={user.isActive ? 'Actif' : 'Désactivé'}
                      size="small"
                      color={user.isActive ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                  <TableCell align="right">
                    <UserActionsMenu
                      user={user}
                      onChanged={refresh}
                      onEdit={() => {
                        setEditing(user);
                        setFormOpen(true);
                      }}
                      onNotify={setInfo}
                      onError={setError}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <UserFormDialog
        open={formOpen}
        user={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />
    </Stack>
  );
}
