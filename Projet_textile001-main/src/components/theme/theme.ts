import { createTheme, alpha } from '@mui/material/styles';

/**
 * Thème visuel JO Management — style « dashboard premium » : fond bleu-gris
 * clair avec cartes blanches flottantes, primaire émeraude, typographie
 * Instrument Sans (avec Fraunces pour les titres éditoriaux), coins très
 * arrondis et ombres diffuses. La logique métier n'est pas affectée.
 */
const primaryMain = '#0f7a4d';
const primaryLight = '#1fae74';
const primaryDark = '#0a5c3c';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: primaryMain,
      light: primaryLight,
      dark: primaryDark,
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#b45309',
      light: '#d97706',
      dark: '#92400e',
      contrastText: '#ffffff',
    },
    background: {
      default: '#eef1f8',
      paper: '#ffffff',
    },
    text: {
      primary: '#1e2430',
      secondary: '#69718a',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily:
      'var(--font-body), "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif',
    h2: { fontWeight: 800, letterSpacing: '-0.02em' },
    h4: { fontWeight: 800, letterSpacing: '-0.01em' },
    h5: { fontWeight: 800, letterSpacing: '-0.01em' },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#eef1f8' },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(30,36,48,0.05)',
          boxShadow: '0 2px 6px rgba(29,41,57,0.04), 0 12px 32px rgba(29,41,57,0.06)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none',
          boxShadow: 'none',
          '&:hover': { boxShadow: '0 6px 16px rgba(15,122,77,0.22)' },
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${primaryMain}, ${primaryLight})`,
          '&:hover': { background: `linear-gradient(135deg, ${primaryDark}, ${primaryMain})` },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 600 },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 10, backgroundColor: '#fff' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#edf0f7' },
        head: {
          backgroundColor: '#f6f8fc',
          color: '#3d4660',
          fontWeight: 700,
          borderColor: '#edf0f7',
          whiteSpace: 'nowrap',
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: { borderRadius: 12 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          marginInline: 8,
          paddingBlock: 6,
          width: 'auto',
          '&:hover': { backgroundColor: alpha(primaryMain, 0.05) },
          '&.Mui-selected': {
            backgroundColor: alpha(primaryMain, 0.1),
            color: primaryMain,
            '& .MuiListItemIcon-root': { color: primaryMain },
            '&:hover': { backgroundColor: alpha(primaryMain, 0.14) },
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 6, height: 6 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(255,255,255,0.86)',
          backdropFilter: 'blur(10px)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10, alignItems: 'center' },
      },
    },
  },
});
