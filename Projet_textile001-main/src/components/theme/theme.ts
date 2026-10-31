import { createTheme, alpha } from '@mui/material/styles';

/**
 * Thème visuel JO Management — direction artistique « maison de luxe
 * textile », alignée sur la page de connexion : porcelaine chaude,
 * émeraude profonde, accents or, titres éditoriaux Fraunces, ombres
 * douces et verre dépoli. La logique métier n'est pas affectée.
 */
const primaryMain = '#0e6b44';
const primaryLight = '#1c9e6b';
const primaryDark = '#0a4f33';

const goldMain = '#a9812e';
const goldLight = '#c8a24b';
const goldDark = '#7c5f1d';

const ink = '#191f1c';
const inkSoft = '#66716a';
const porcelain = '#f4f1ea';
const paper = '#fffdf9';

const displayFont =
  'var(--font-display), Georgia, "Times New Roman", serif';
const bodyFont =
  'var(--font-body), "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';

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
      main: goldMain,
      light: goldLight,
      dark: goldDark,
      contrastText: '#ffffff',
    },
    background: {
      default: porcelain,
      paper,
    },
    text: {
      primary: ink,
      secondary: inkSoft,
    },
    divider: 'rgba(25,31,28,0.08)',
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: bodyFont,
    h1: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '-0.015em',
    },
    h2: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '-0.015em',
    },
    h3: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h4: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h5: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '0.005em',
    },
    subtitle1: {
      fontFamily: displayFont,
      fontWeight: 600,
      letterSpacing: '0.005em',
    },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 650, letterSpacing: '0.01em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: porcelain,
          backgroundImage:
            'radial-gradient(1100px 700px at 88% -12%, rgba(169,129,46,0.07), transparent 62%),' +
            'radial-gradient(900px 620px at -8% 112%, rgba(14,107,68,0.06), transparent 60%)',
          backgroundAttachment: 'fixed',
          textRendering: 'optimizeLegibility',
        },
        '::selection': {
          backgroundColor: 'rgba(169,129,46,0.25)',
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(25,31,28,0.06)',
          boxShadow:
            '0 1px 2px rgba(25,31,28,0.04), 0 12px 32px rgba(25,31,28,0.05)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none',
          boxShadow: 'none',
          transition: 'box-shadow .2s ease, transform .2s ease, background-color .2s ease',
          '&:active': { transform: 'translateY(1px)' },
          '&:hover': { boxShadow: '0 8px 20px rgba(14,107,68,0.22)' },
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${primaryDark} 0%, ${primaryMain} 55%, ${primaryLight} 130%)`,
          '&:hover': {
            background: `linear-gradient(135deg, ${primaryDark}, ${primaryMain})`,
            boxShadow: '0 10px 24px rgba(14,107,68,0.32)',
          },
        },
        outlined: {
          borderColor: 'rgba(25,31,28,0.16)',
          '&:hover': {
            borderColor: primaryMain,
            backgroundColor: alpha(primaryMain, 0.05),
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 600 },
        outlined: {
          borderColor: 'rgba(169,129,46,0.45)',
          color: goldDark,
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundColor: paper,
          transition: 'box-shadow .18s ease, border-color .18s ease',
          '&:hover:not(.Mui-focused)': {
            backgroundColor: '#ffffff',
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${alpha(goldMain, 0.16)}`,
          },
        },
        notchedOutline: {
          borderColor: 'rgba(25,31,28,0.12)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: 'rgba(25,31,28,0.07)' },
        head: {
          backgroundColor: '#f5f2e9',
          color: '#3d4a42',
          fontWeight: 700,
          borderColor: 'rgba(25,31,28,0.07)',
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
          transition: 'background-color .18s ease, color .18s ease',
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
        root: { borderRadius: 6, height: 6, backgroundColor: 'rgba(25,31,28,0.07)' },
        bar: { borderRadius: 6 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
          border: '1px solid rgba(25,31,28,0.06)',
          boxShadow:
            '0 24px 70px rgba(25,31,28,0.18), 0 4px 14px rgba(25,31,28,0.08)',
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(16,22,19,0.42)',
          backdropFilter: 'blur(4px)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(255,253,248,0.84)',
          backdropFilter: 'blur(12px)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10, alignItems: 'center' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#101613',
          color: '#eef0ea',
          fontSize: 12,
          borderRadius: 8,
          padding: '6px 10px',
        },
        arrow: { color: '#101613' },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: 'rgba(25,31,28,0.08)' },
      },
    },
  },
});
