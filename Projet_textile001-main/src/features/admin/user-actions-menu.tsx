'use client';

import Edit from '@mui/icons-material/Edit';
import MoreVert from '@mui/icons-material/MoreVert';
import RestartAlt from '@mui/icons-material/RestartAlt';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState, type MouseEvent } from 'react';
import { apiPost } from '@/services/api-client';
import type { ManagedUser } from '@/types/auth';

/**
 * Menu d'actions d'une ligne utilisateur : modification, activation /
 * désactivation (avec confirmation), réinitialisation de mot de passe.
 */

interface Props {
  user: ManagedUser;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}

export default function UserActionsMenu({
  user,
  onEdit,
  onChanged,
  onNotify,
  onError,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  function open(event: MouseEvent<HTMLElement>) {
    setAnchor(event.currentTarget);
  }

  function close() {
    setAnchor(null);
  }

  async function run(action: () => Promise<void>, success: string) {
    close();
    setBusy(true);
    try {
      await action();
      onNotify(success);
      await onChanged();
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : 'Erreur lors de l’action.',
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleActive() {
    const target = user.isActive ? 'désactiver' : 'réactiver';
    if (
      !window.confirm(
        `Confirmer l’action : ${target} le compte « ${user.username} » ?` +
          (user.isActive
            ? ' Ses sessions en cours seront révoquées.'
            : ''),
      )
    ) {
      close();
      return;
    }
    void run(async () => {
      await apiPost(`/api/admin/users/${user.id}/actions`, {
        action: user.isActive ? 'deactivate' : 'activate',
      });
    }, user.isActive ? 'Compte désactivé.' : 'Compte réactivé.');
  }

  function resetPassword() {
    if (
      !window.confirm(
        `Confirmer la réinitialisation du mot de passe de « ${user.username} » ? Le compte devra définir un nouveau mot de passe à la prochaine connexion.`,
      )
    ) {
      close();
      return;
    }
    void run(async () => {
      const result = await apiPost<{
        status: string;
        temporaryPassword?: string;
      }>(`/api/admin/users/${user.id}/actions`, { action: 'reset-password' });
      if (result.temporaryPassword) {
        window.alert(
          `Mot de passe temporaire à communiquer à l’utilisateur (affiché une seule fois) :\n\n${result.temporaryPassword}`,
        );
      }
    }, 'Mot de passe réinitialisé.');
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        aria-label={`Actions pour ${user.username}`}
        className="rounded p-1 hover:bg-black/5"
      >
        <MoreVert fontSize="small" />
      </button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <MenuItem
          onClick={() => {
            close();
            onEdit();
          }}
        >
          <ListItemIcon>
            <Edit fontSize="small" />
          </ListItemIcon>
          Modifier
        </MenuItem>
        <MenuItem onClick={toggleActive}>
          <ListItemIcon>
            <RestartAlt fontSize="small" />
          </ListItemIcon>
          {user.isActive ? 'Désactiver le compte' : 'Réactiver le compte'}
        </MenuItem>
        <MenuItem onClick={resetPassword}>
          <ListItemIcon>
            <RestartAlt fontSize="small" />
          </ListItemIcon>
          Réinitialiser le mot de passe
        </MenuItem>
      </Menu>
    </>
  );
}
