import type { SvgIconComponent } from '@mui/icons-material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import WarehouseOutlinedIcon from '@mui/icons-material/WarehouseOutlined';

/**
 * Référentiel des modules métier prévus.
 * Tous sont à l'état « planned » : la navigation les affiche
 * comme à venir, sans simuler des fonctionnalités disponibles.
 */

export type ModuleStatus = 'planned';

export interface ModuleDefinition {
  key: string;
  label: string;
  description: string;
  icon: SvgIconComponent;
  status: ModuleStatus;
}

export const MODULES: ModuleDefinition[] = [
  {
    key: 'auth',
    label: 'Authentification',
    description: 'Comptes utilisateurs et accès sécurisés.',
    icon: LockOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'admin',
    label: 'Administration',
    description: 'Configuration générale de l’entreprise.',
    icon: AdminPanelSettingsIcon,
    status: 'planned',
  },
  {
    key: 'settings',
    label: 'Paramètres',
    description: 'Réglages applicatifs et préférences.',
    icon: SettingsOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'cutting',
    label: 'Coupe',
    description: 'Suivi des opérations de coupe.',
    icon: ContentCutIcon,
    status: 'planned',
  },
  {
    key: 'sewing',
    label: 'Couture',
    description: 'Ateliers et avancement de la couture.',
    icon: PrecisionManufacturingOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'quality',
    label: 'Contrôle qualité',
    description: 'Inspections et validation des pièces.',
    icon: FactCheckOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'rework',
    label: 'Retouche',
    description: 'Gestion des retouches et corrections.',
    icon: BuildOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'cartons',
    label: 'Cartons',
    description: 'Conditionnement et suivi des cartons.',
    icon: Inventory2OutlinedIcon,
    status: 'planned',
  },
  {
    key: 'stock',
    label: 'Stock',
    description: 'Niveaux et mouvements de stock.',
    icon: WarehouseOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'warehouse',
    label: 'Magasinier',
    description: 'Réceptions et import de documents PDF.',
    icon: PictureAsPdfOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'security',
    label: 'Sécurité',
    description: 'Contrôle des sorties d’usine.',
    icon: SecurityOutlinedIcon,
    status: 'planned',
  },
  {
    key: 'waste',
    label: 'Déchets',
    description: 'Déchets de production et reventes.',
    icon: DeleteOutlineIcon,
    status: 'planned',
  },
  {
    key: 'dashboards',
    label: 'Tableaux de bord',
    description: 'Rapports et indicateurs de gestion.',
    icon: InsightsOutlinedIcon,
    status: 'planned',
  },
];
