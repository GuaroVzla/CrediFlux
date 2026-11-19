'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Shield, Key, Lock, User, Users, Smartphone, DollarSign,
  TrendingUp, AlertTriangle, CheckCircle, Clock, Calendar, History,
  CreditCard, Search, Plus, Trash2, Edit3, Eye, EyeOff, FileText,
  Upload, Sparkles, RefreshCw, LogOut, Sun, Moon, ArrowUpRight,
  ArrowDownRight, Check, X, ChevronRight, ChevronDown, ChevronUp, PieChart,
  ShoppingBag, Building, ShieldCheck, Phone, MapPin, Award, UserPlus,
  Wallet, Ban,
  HelpCircle, AlertCircle, Briefcase, Save, Coins, Landmark
} from 'lucide-react';
import { getTrustLevelConfig, computeClientTrust } from '../lib/trust';

const PURGE_TARGET_KEYS = [
  'payments',
  'loans',
  'clients',
  'products',
  'ecommerce',
  'capital'
];

const PURGE_TARGET_OPTIONS = [
  ['payments', 'Historial de financiamientos (pagos)'],
  ['loans', 'Eliminar financiamientos'],
  ['clients', 'Clientes'],
  ['products', 'Productos'],
  ['ecommerce', 'Registro cronológico de transacciones de e-commerce'],
  ['capital', 'Capital operativo (montos e historial de aportes y retiros)']
];

const EMPTY_PURGE_TARGETS = Object.fromEntries(PURGE_TARGET_KEYS.map((key) => [key, false]));

export default function CrediFluxApp() {
  // Authentication & Session
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginInput, setLoginInput] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [themeDark, setThemeDark] = useState(true);

  // Active Tab: 'dashboard' | 'loans' | 'clients' | 'products' | 'ecommerce' | 'settings'
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  // Dashboard: filtros cronológicos
  const [dashPeriodMode, setDashPeriodMode] = useState('month'); // 'month' | 'year' | 'range'
  const [dashMonth, setDashMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [dashYear, setDashYear] = useState(String(new Date().getFullYear()));
  const [dashDateFrom, setDashDateFrom] = useState('');
  const [dashDateTo, setDashDateTo] = useState('');

  // Core Data States
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [ecommerceData, setEcommerceData] = useState({ summary: {}, transactions: [] });

  // Capital (Aportes y Retiros)
  const [capitalModal, setCapitalModal] = useState({ open: false, tab: 'movimiento', type: 'APORTE_CAPITAL', amount: '', notes: '', loading: false });
  const [capitalMovements, setCapitalMovements] = useState([]);
  const [capitalSummary, setCapitalSummary] = useState({aportes: 0, retiros: 0, netCapital: 0, count: 0 });
  const [settings, setSettings] = useState({});
  const [adminUsersList, setAdminUsersList] = useState([]);
  // La clave revelada se muestra tras un clic y se oculta al volver a hacer clic
  // (o automáticamente después de unos segundos).
  const [revealedPassword, setRevealedPassword] = useState(null);
  const passwordRequestIdRef = useRef(0);
  const passwordHideTimerRef = useRef(null);
  const hidePasswordRef = useRef(null);
  const [receiptPatterns, setReceiptPatterns] = useState([]);

  // Modal para Cargar Patrón de Comprobante (Admin)
  const [patternModal, setPatternModal] = useState(false);
  const [patternForm, setPatternForm] = useState({
    bankName: '',
    referenceFormat: '',
    keywords: '',
    notes: '',
    file: null,
    filePreview: null,
    processing: false
  });
  const patternFileInputRef = useRef(null);
  const importSettingsInputRef = useRef(null);

  // Parámetros Avanzados del Motor OCR (Endpoints, Modelos Seleccionados y Umbrales)
  const [ocrAdvancedOpen, setOcrAdvancedOpen] = useState(false);
  const [ocrEndpointsForm, setOcrEndpointsForm] = useState({
    openai: 'https://api.openai.com/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
    ocrspace: 'https://api.ocr.space/parse/image',
    tesseract: 'local'
  });
  const [ocrModelsForm, setOcrModelsForm] = useState({
    openai: 'gpt-4o-mini',
    gemini: 'gemini-1.5-flash',
    ocrspace: 'Engine2',
    tesseract: 'spa+eng'
  });
  const [ocrThresholdsForm, setOcrThresholdsForm] = useState({
    ocrConfidenceMin: 0.8,
    strictBankMatch: false,
    requireReferenceMatch: true
  });

  // Modals
  const [clientModal, setClientModal] = useState({ open: false, data: null });
  const [productModal, setProductModal] = useState({ open: false, data: null });
  const [loanModal, setLoanModal] = useState({ open: false, data: null });
  const [quickPayModal, setQuickPayModal] = useState({ open: false, loan: null });
  const [quickPaySelection, setQuickPaySelection] = useState(''); // 'all' o número de cuota
  const [expandedLoanId, setExpandedLoanId] = useState(null);
  const [viewHistoryClient, setViewHistoryClient] = useState(null);
  const [notification, setNotification] = useState(null);

  // Admin New User Modal (Formulario de Registro Exclusivo de Admin)
  const [newUserModal, setNewUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    password: '',
    address: '',
    phone: '',
    licenseDurationMonths: 1,
    assignedLicenseKey: ''
  });

  // Admin Edit User Modal
  const [editUserModal, setEditUserModal] = useState({ open: false, user: null });
  const [purgeModal, setPurgeModal] = useState({
    open: false,
    user: null,
    targets: { ...EMPTY_PURGE_TARGETS },
    filter: { period: 'all', day: '', month: '', year: '', until: '' },
    processing: false
  });

  const purgeTargetSelection = PURGE_TARGET_KEYS.map((key) => Boolean(purgeModal.targets?.[key]));
  const allPurgeTargetsSelected = purgeTargetSelection.every(Boolean);
  const somePurgeTargetsSelected = purgeTargetSelection.some(Boolean);
  const selectAllPurgeRef = useRef(null);

  useEffect(() => {
    if (selectAllPurgeRef.current) {
      selectAllPurgeRef.current.indeterminate = somePurgeTargetsSelected && !allPurgeTargetsSelected;
    }
  }, [somePurgeTargetsSelected, allPurgeTargetsSelected, purgeModal.open]);

  // End-user license renewal form
  const [renewLicenseKey, setRenewLicenseKey] = useState('');

  // Motor IA de Ajustes: proveedor OCR seleccionado, credenciales por proveedor y resultado de prueba
  const [ocrProvider, setOcrProvider] = useState('openai');
  const [ocrProviderKeys, setOcrProviderKeys] = useState({
    openai: '',
    gemini: '',
    ocrspace: '',
    tesseract: ''
  });
  const [ocrConnectionTest, setOcrConnectionTest] = useState({ status: 'idle', message: '' });
  const [testingConnection, setTestingConnection] = useState(false);

  // E-Commerce OCR Upload Form State
  const [ocrForm, setOcrForm] = useState({
    type: 'venta_usdt',
    reference: '',
    date: new Date().toISOString().split('T')[0],
    file: null,
    filePreview: null,
    processing: false,
    ocrExtracted: null
  });

  // Transactions table filters & sort
  const [txSearch, setTxSearch] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState('todos');
  const [txSortField, setTxSortField] = useState('createdAt');
  const [txSortDir, setTxSortDir] = useState('asc');

  // Calculations module
  const [calcPeriod, setCalcPeriod] = useState('month');
  const [calcDate, setCalcDate] = useState(new Date().toISOString().slice(0, 7));
  const fileInputRef = useRef(null);

  // Search & Filter
  const [clientSearch, setClientSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productSort, setProductSort] = useState({ field: 'name', dir: 'asc' });
  const [debtorStatusFilter, setDebtorStatusFilter] = useState('todos');
  const [loanSearch, setLoanSearch] = useState('');
  const [loanSort, setLoanSort] = useState({ field: 'clientName', dir: 'asc' });
  const [historyModal, setHistoryModal] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [loanStatsFilter, setLoanStatsFilter] = useState(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    return { mode: 'month', day: today, month: ym, year: String(now.getFullYear()), from: today, to: today };
  });
  const [deleteLoanModal, setDeleteLoanModal] = useState({ open: false, loan: null, processing: false });
  const [blacklist, setBlacklist] = useState([]);
  const [blacklistModal, setBlacklistModal] = useState(false);
  const [blacklistSearch, setBlacklistSearch] = useState('');
  const [restoringBlacklistId, setRestoringBlacklistId] = useState(null);

  // Tasas de cambio: BCV (oficial, dolarapi.com) y promedio P2P de Binance (VES/USDT)
  const [dolarRates, setDolarRates] = useState({
    oficial: null,
    p2pAverage: null,
    p2pBuy: null,
    p2pSell: null,
    p2pUpdatedAt: null,
    loading: false,
    error: false
  });

  // Contact support info for expired license
  const SUPPORT_CONTACT_TEXT = "Licencia del sistema caducada, favor comunicarse con el administrador del sistema. Informacion de contacto: telefono: +584126770824 correo: Oswaldoserrano18@gmail.com";

  // Show Toast Notification
  const notify = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // ---------- Vista previa de clave: clic para mostrar / clic para ocultar ----------
  // No usamos AbortController: en Next 16 abortar una petición mientras el proxy/middleware
  // está activo provoca un ECONNRESET/uncaughtException en el servidor de desarrollo.
  // Las respuestas obsoletas se descartan con un token secuencial y la clave se
  // oculta sola a los 15 segundos para no dejarla expuesta en pantalla.
  const PASSWORD_REVEAL_MS = 15000;

  const hidePassword = () => {
    passwordRequestIdRef.current += 1;
    if (passwordHideTimerRef.current) {
      clearTimeout(passwordHideTimerRef.current);
      passwordHideTimerRef.current = null;
    }
    setRevealedPassword(null);
  };
  hidePasswordRef.current = hidePassword;

  const togglePassword = async (user) => {
    const isCurrentlyShown = revealedPassword?.userId === user.id && revealedPassword.password;
    if (isCurrentlyShown) {
      hidePassword();
      return;
    }

    hidePassword();
    const requestId = passwordRequestIdRef.current;
    setRevealedPassword({ userId: user.id, password: null, loading: true, reason: null });
    try {
      const res = await fetch('/api/admin/reveal-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || ''
        },
        body: JSON.stringify({ userId: user.id }),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      // Si hizo clic en otro usuario o volvió a ocultar, ignoramos la respuesta.
      if (passwordRequestIdRef.current !== requestId) return;
      if (res.ok && data.success && data.available && data.password) {
        setRevealedPassword({ userId: user.id, password: data.password, loading: false, reason: null });
        passwordHideTimerRef.current = setTimeout(() => {
          passwordHideTimerRef.current = null;
          hidePasswordRef.current?.();
        }, PASSWORD_REVEAL_MS);
      } else {
        const reason = data.code === 'PREVIEW_UNAVAILABLE' ? 'unavailable' : (data.reason || 'hash');
        setRevealedPassword({ userId: user.id, password: null, loading: false, reason });
      }
    } catch {
      if (passwordRequestIdRef.current !== requestId) return;
      setRevealedPassword({ userId: user.id, password: null, loading: false, reason: 'error' });
    }
  };

  useEffect(() => {
    const release = () => hidePasswordRef.current?.();
    const releaseIfHidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', releaseIfHidden);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', releaseIfHidden);
      if (passwordHideTimerRef.current) clearTimeout(passwordHideTimerRef.current);
      hidePasswordRef.current?.();
    };
  }, []);

  // Toggle Dark/Light Theme
  const toggleTheme = () => {
    setThemeDark(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return next;
    });
  };

  // Inicializa y valida la sesión contra Supabase (cookie httpOnly gestionada por @supabase/ssr).
  useEffect(() => {
    const bootstrapSession = async () => {
      const savedUser = localStorage.getItem('crediflux_user') || localStorage.getItem('ricardo_user');
      if (savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          setCurrentUser(parsedUser);
        } catch (e) {}
      }

      try {
        const res = await fetch('/api/auth', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));

        // 401 = la cookie de sesión no existe o expiró: se cierra la sesión local.
        if (res.status === 401) {
          localStorage.removeItem('crediflux_token');
          localStorage.removeItem('crediflux_user');
          localStorage.removeItem('ricardo_token');
          localStorage.removeItem('ricardo_user');
          setCurrentUser(null);
          setIsAuthenticated(false);
          return;
        }

        if (res.ok && data.success && data.user) {
          localStorage.setItem('crediflux_user', JSON.stringify(data.user));
          setCurrentUser(data.user);
          setIsAuthenticated(true);
          fetchAllData();
          return;
        }

        // 503 o error transitorio (Supabase aún no configurado, red caída):
        // se conserva la sesión local para no expulsar al usuario.
        if (savedUser) {
          setIsAuthenticated(true);
          fetchAllData();
        }
      } catch (e) {
        // Sin conexión: se conserva la sesión local solo para visualización.
        if (savedUser) {
          setIsAuthenticated(true);
          fetchAllData();
        }
      }
    };
    bootstrapSession();
  }, []);

  // Tasas de cambio: BCV oficial (dolarapi.com) + promedio ponderado P2P de Binance (VES/USDT)
  // El endpoint /api/binance-p2p cachea en servidor 3 minutos; forceP2P evita la caché (botón refrescar).
  const fetchDolarRates = async (options = {}) => {
    const forceP2P = Boolean(options.forceP2P);
    setDolarRates(prev => ({ ...prev, loading: true, error: false }));

    const [oficialResult, p2pResult] = await Promise.allSettled([
      fetch('https://ve.dolarapi.com/v1/dolares/oficial').then(r => r.json()),
      fetch(`/api/binance-p2p${forceP2P ? '?force=1' : ''}`, { cache: 'no-store' }).then(r => r.json())
    ]);

    setDolarRates(prev => {
      const next = { ...prev, loading: false, error: false };

      if (oficialResult.status === 'fulfilled') {
        const oficial = Number(oficialResult.value?.promedio);
        if (Number.isFinite(oficial) && oficial > 0) next.oficial = oficial;
      } else {
        next.error = true;
      }

      if (p2pResult.status === 'fulfilled' && p2pResult.value?.success) {
        const p2p = p2pResult.value;
        const average = Number(p2p.average);
        if (Number.isFinite(average) && average > 0) {
          next.p2pAverage = average;
          next.p2pBuy = Number(p2p.buy?.price) || null;
          next.p2pSell = Number(p2p.sell?.price) || null;
          next.p2pUpdatedAt = p2p.updatedAt || null;
        }
      } else {
        // Se conservan las últimas tasas P2P conocidas ante fallos transitorios de Binance
        next.error = true;
      }

      return next;
    });

    // Histórico de tasas BCV / Binance P2P en Supabase (RLS por usuario).
    if (isAuthenticated) {
      const officialRate = oficialResult.status === 'fulfilled' ? Number(oficialResult.value?.promedio) : NaN;
      const p2pPayload = p2pResult.status === 'fulfilled' ? p2pResult.value : null;
      const fetchedAt = new Date().toISOString();

      if (Number.isFinite(officialRate) && officialRate > 0) {
        fetch('/api/exchange-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'bcv', rate: officialRate, fetchedAt })
        }).catch(() => {});
      }

      const p2pAverage = Number(p2pPayload?.average);
      if (p2pPayload?.success && Number.isFinite(p2pAverage) && p2pAverage > 0) {
        fetch('/api/exchange-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'binance_p2p',
            rate: p2pAverage,
            buyRate: Number(p2pPayload.buy?.price) || null,
            sellRate: Number(p2pPayload.sell?.price) || null,
            fetchedAt: p2pPayload.updatedAt || fetchedAt,
            raw: p2pPayload
          })
        }).catch(() => {});
      }
    }
  };

  // Actualización automática de tasas cada 5 minutos mientras la sesión esté activa.
  // El endpoint P2P cachea 3 minutos en servidor, por lo que no se satura la API pública.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const interval = setInterval(() => { fetchDolarRates(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Fetch all modules data from backend
  const fetchAllData = async (options = {}) => {
    setLoading(true);
    fetchDolarRates({ forceP2P: Boolean(options.forceP2P) });
    try {
      const savedUser = localStorage.getItem('crediflux_user') || localStorage.getItem('ricardo_user');
      const userId = savedUser ? JSON.parse(savedUser).id : '';

      const headers = { 'x-user-id': userId };

      const [resClients, resProducts, resLoans, resPayments, resEcom, resSettings, resCapital] = await Promise.all([
        fetch('/api/clients', { headers }).then(r => r.json()),
        fetch('/api/products', { headers }).then(r => r.json()),
        fetch('/api/loans', { headers }).then(r => r.json()),
        fetch('/api/payments', { headers }).then(r => r.json()),
        fetch('/api/ecommerce', { headers }).then(r => r.json()),
        fetch('/api/settings', { headers }).then(r => r.json()),
        fetch('/api/capital-movements', { headers }).then(r => r.json())
      ]);

      if (resClients.success) {
        setClients(resClients.clients);
        setBlacklist(resClients.blacklist || []);
      }
      if (resProducts.success) {
        setProducts((resProducts.products || []).map(p => {
          const cost = Number(p.costPrice) || 0;
          let margin = Number(p.profitMarginPercent);
          if (!Number.isFinite(margin)) {
            margin = cost > 0 && Number(p.salePrice) > 0
              ? Number((((Number(p.salePrice) - cost) / cost) * 100).toFixed(1))
              : 30;
          }
          const sale = Number(p.salePrice) > 0
            ? Number(p.salePrice)
            : Number((cost * (1 + margin / 100)).toFixed(2));
          return {
            ...p,
            costPrice: cost,
            salePrice: sale,
            profitMarginPercent: margin,
            manualSalePrice: Boolean(p.manualSalePrice)
          };
        }));
      }
      if (resLoans.success) setLoans(resLoans.loans);
      if (resPayments?.success) setPayments(resPayments.payments || []);
      if (resEcom.success) setEcommerceData(resEcom);

      if (resSettings.success) {
        setSettings(resSettings.settings);
        const allowedUiProviders = ['openai', 'gemini', 'ocrspace', 'tesseract'];
        const nextProvider = allowedUiProviders.includes(resSettings.settings?.aiProvider)
          ? resSettings.settings.aiProvider
          : 'openai';
        setOcrProvider(nextProvider);
        if (resSettings.settings?.ocrKeys) {
          setOcrProviderKeys(prev => ({
            ...prev,
            openai: resSettings.settings.ocrKeys.openai || '',
            gemini: resSettings.settings.ocrKeys.gemini || '',
            ocrspace: resSettings.settings.ocrKeys.ocrspace || '',
            tesseract: ''
          }));
        } else {
          // Compatibilidad con respuestas legacy (sin ocrKeys)
          setOcrProviderKeys(prev => ({
            ...prev,
            ocrspace: resSettings.settings?.ocrSpaceApiKey || prev.ocrspace || '',
            openai: resSettings.settings?.aiProvider === 'openai' ? (resSettings.settings?.aiApiKey || prev.openai || '') : prev.openai,
            gemini: resSettings.settings?.aiProvider === 'gemini' ? (resSettings.settings?.aiApiKey || prev.gemini || '') : prev.gemini
          }));
        }
        if (resSettings.users) {
          setAdminUsersList(resSettings.users);
        }
        if (resSettings.receiptPatterns) {
          setReceiptPatterns(resSettings.receiptPatterns);
        }
        if (resSettings.settings?.ocrEndpoints) {
          setOcrEndpointsForm(prev => ({ ...prev, ...resSettings.settings.ocrEndpoints }));
        }
        if (resSettings.settings?.ocrModels) {
          setOcrModelsForm(prev => ({ ...prev, ...resSettings.settings.ocrModels }));
        }
        if (resSettings.settings?.ocrThresholds) {
          setOcrThresholdsForm(prev => ({
            ...prev,
            ...resSettings.settings.ocrThresholds,
            ocrConfidenceMin: resSettings.settings.ocrConfidenceMin ?? prev.ocrConfidenceMin
          }));
        }
        if (resSettings.currentUserInfo) {
          const updatedUser = {
            ...resSettings.currentUserInfo,
            isExpired: checkIsExpired(resSettings.currentUserInfo)
          };
          setCurrentUser(updatedUser);
          localStorage.setItem('crediflux_user', JSON.stringify(updatedUser));
        }
      }

      // Capital movements summary from API
      if (resCapital.success) {
        setCapitalMovements(resCapital.movements || []);
        setCapitalSummary(resCapital.summary || {aportes: 0, retiros: 0, netCapital: 0, count: 0 });
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      notify('Error al sincronizar datos', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Margen por defecto (30%) y precio calculado en modo automático
  const DEFAULT_PROFIT_MARGIN = 30;
  const getProductMargin = (prod) => {
    const margin = Number(prod?.profitMarginPercent);
    return Number.isFinite(margin) ? margin : DEFAULT_PROFIT_MARGIN;
  };
  const getAutoSalePrice = (prod) => {
    const cost = Number(prod?.costPrice) || 0;
    return Number((cost * (1 + getProductMargin(prod) / 100)).toFixed(2));
  };

  // Ordenamiento dinámico de la tabla de productos
  const toggleProductSort = (field) => {
    setProductSort(prev => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' });
  };

  // Persiste los cambios inline de la tabla (margen / precio de venta)
  const persistProduct = async (product, patch) => {
    try {
      const payload = {
        id: product.id,
        name: product.name,
        category: product.category,
        costPrice: Number(product.costPrice) || 0,
        stock: Number(product.stock) || 0,
        salePrice: product.salePrice,
        profitMarginPercent: getProductMargin(product),
        manualSalePrice: Boolean(product.manualSalePrice),
        ...patch
      };
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || ''
        },
        body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (d.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }
      if (d.success && d.product) {
        setProducts(prev => prev.map(p => p.id === d.product.id ? d.product : p));
      } else if (!d.success) {
        notify(d.error || 'No se pudo guardar el producto', 'error');
      }
    } catch (err) {
      console.error('Error saving product:', err);
      notify('Error al guardar producto', 'error');
    }
  };

  // Ajuste del margen con flechas externas al campo (incremento/decremento)
  const stepProductMargin = (product, delta) => {
    const live = products.find(p => p.id === product.id) || product;
    const current = getProductMargin(live);
    const nextMargin = Number(Math.min(100, Math.max(0, current + delta)).toFixed(1));
    if (nextMargin === current) return;
    const cost = Number(live.costPrice) || 0;
    const nextSale = Number((cost * (1 + nextMargin / 100)).toFixed(2));
    setProducts(prev => prev.map(p => p.id === live.id
      ? { ...p, profitMarginPercent: nextMargin, salePrice: nextSale, manualSalePrice: false }
      : p));
    persistProduct(live, { profitMarginPercent: nextMargin, salePrice: nextSale, manualSalePrice: false });
  };

  // Elimina un cliente desde la tabla de registros
  const deleteClient = async (client) => {
    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
    if (!client?.id) return;
    if (!confirm(`¿Eliminar el cliente "${client.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/clients?id=${encodeURIComponent(client.id)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || ''
        }
      });
      const d = await res.json();
      if (d.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }
      if (d.success) {
        notify(d.message || 'Cliente eliminado');
        if (viewHistoryClient?.id === client.id) setViewHistoryClient(null);
        fetchAllData();
      } else {
        notify(d.error || 'Error al eliminar cliente', 'error');
      }
    } catch (err) {
      console.error('Error deleting client:', err);
      notify('Error de red al eliminar cliente', 'error');
    }
  };

  // Elimina un pago del historial y revierte la cuota asociada (actualiza cartera y estadísticas)
  const deletePaymentRecord = async (payment) => {
    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
    if (!payment?.id) return;
    if (!confirm(`¿Eliminar el pago registrado (${payment.clientName || 'cliente'}, $${Number(payment.amount || 0).toFixed(2)})? La cuota asociada volverá a pendiente y los cuadros estadísticos se actualizarán.`)) return;

    try {
      const res = await fetch(`/api/payments?id=${encodeURIComponent(payment.id)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || ''
        }
      });
      const d = await res.json();
      if (d.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }
      if (d.success) {
        notify(d.message || 'Pago eliminado del historial');
        fetchAllData();
      } else {
        notify(d.error || 'Error al eliminar pago', 'error');
      }
    } catch (err) {
      console.error('Error deleting payment:', err);
      notify('Error de red al eliminar pago', 'error');
    }
  };

  // Da de baja un financiamiento por incumplimiento y envía al cliente a Lista Negra
  const confirmDeleteLoan = async () => {
    const loan = deleteLoanModal.loan;
    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
    if (!loan?.id) return;

    setDeleteLoanModal(prev => ({ ...prev, processing: true }));
    try {
      const res = await fetch(`/api/loans?id=${encodeURIComponent(loan.id)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || ''
        }
      });
      const d = await res.json();
      if (d.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        setDeleteLoanModal(prev => ({ ...prev, processing: false }));
        return;
      }
      if (d.success) {
        notify(d.message || 'Financiamiento dado de baja');
        setDeleteLoanModal({ open: false, loan: null, processing: false });
        if (expandedLoanId === loan.id) setExpandedLoanId(null);
        fetchAllData();
      } else {
        notify(d.error || 'Error al dar de baja el financiamiento', 'error');
        setDeleteLoanModal(prev => ({ ...prev, processing: false }));
      }
    } catch (err) {
      console.error('Error deleting loan:', err);
      notify('Error de red al dar de baja el financiamiento', 'error');
      setDeleteLoanModal(prev => ({ ...prev, processing: false }));
    }
  };

  // Reincorpora un cliente desde la Lista Negra a la tabla activa
  const restoreBlacklistedClient = async (entry) => {
    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
    if (!entry?.id) return;
    if (!confirm(`¿Reincorporar a "${entry.name}" a los clientes activos?`)) return;

    setRestoringBlacklistId(entry.id);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || ''
        },
        body: JSON.stringify({ action: 'restore', blacklistId: entry.id })
      });
      const d = await res.json();
      if (d.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }
      if (d.success) {
        notify(d.message || 'Cliente reincorporado');
        fetchAllData();
      } else {
        notify(d.error || 'Error al reincorporar cliente', 'error');
      }
    } catch (err) {
      console.error('Error restoring client:', err);
      notify('Error de red al reincorporar cliente', 'error');
    } finally {
      setRestoringBlacklistId(null);
    }
  };

  // Helper para verificar expiración en frontend
  const checkIsExpired = (user) => {
    if (!user || user.role === 'admin') return false;
    if (!user.licenseExpiresAt) return true;
    return new Date(user.licenseExpiresAt).getTime() < new Date().getTime();
  };

  // Helper para calcular barra de consumo de días de licencia
  const calculateLicenseProgress = (user) => {
    if (!user || user.role === 'admin') return { percent: 100, daysLeft: 999, totalDays: 999, isExpired: false };
    if (!user.licenseExpiresAt) return { percent: 0, daysLeft: 0, totalDays: 30, isExpired: true };

    const now = new Date().getTime();
    const expiry = new Date(user.licenseExpiresAt).getTime();
    const assigned = user.licenseAssignedAt ? new Date(user.licenseAssignedAt).getTime() : (expiry - (user.licenseDurationMonths || 1) * 30 * 24 * 60 * 60 * 1000);

    const totalMs = Math.max(1, expiry - assigned);
    const leftMs = expiry - now;

    const daysLeft = Math.ceil(leftMs / (1000 * 60 * 60 * 24));
    const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24));

    if (leftMs <= 0) {
      return { percent: 0, daysLeft: 0, totalDays, isExpired: true };
    }

    const percent = Math.min(100, Math.max(0, Math.round((leftMs / totalMs) * 100)));
    return { percent, daysLeft, totalDays, isExpired: false };
  };

  // Login handler (SOLO ACCESO PÚBLICO - SIN REGISTRO)
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: loginInput.username,
          password: loginInput.password
        })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('crediflux_token', data.token);
        localStorage.setItem('crediflux_user', JSON.stringify(data.user));
        localStorage.removeItem('ricardo_token');
        localStorage.removeItem('ricardo_user');
        setCurrentUser(data.user);
        setIsAuthenticated(true);
        notify(`Bienvenido, ${data.user.name}`);
        fetchAllData();
      } else {
        setAuthError(data.error || 'Credenciales inválidas');
      }
    } catch (err) {
      setAuthError('Error de conexión con el servidor');
    }
  };

  // Admin registra un nuevo usuario final con licencia en CrediFlux
  const handleAdminRegisterUser = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({
          action: 'register',
          ...newUserForm
        })
      });
      const data = await res.json();
      if (data.success) {
        notify(`¡Usuario final ${data.user.name} registrado con éxito!`);
        setNewUserModal(false);
        setNewUserForm({
          name: '',
          username: '',
          password: '',
          address: '',
          phone: '',
          licenseDurationMonths: 1,
          assignedLicenseKey: ''
        });
        fetchAllData();
      } else {
        notify(data.error || 'Error al registrar usuario', 'error');
      }
    } catch (err) {
      notify('Error al comunicarse con el servidor', 'error');
    }
  };

  // Generar clave de licencia aleatoria previa desde el modal de admin
  const handleAdminGenerateLicense = async (months) => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({
          action: 'generate_license',
          licenseDurationMonths: months
        })
      });
      const d = await res.json();
      if (d.success) {
        setNewUserForm(prev => ({
          ...prev,
          assignedLicenseKey: d.licenseKey,
          licenseDurationMonths: months
        }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      });
    } catch (e) {}
    localStorage.removeItem('crediflux_token');
    localStorage.removeItem('crediflux_user');
    localStorage.removeItem('ricardo_token');
    localStorage.removeItem('ricardo_user');
    setIsAuthenticated(false);
    setCurrentUser(null);
    notify('Sesión cerrada correctamente');
  };

  // Calculate Dashboard KPIs
  const isActiveLoan = (l) => Boolean(l) && !l.archived && l.status !== 'completado' && l.status !== 'archivado';
  const activeLoans = loans.filter(isActiveLoan);
  const totalLentActive = activeLoans.reduce((sum, l) => sum + (l.financedAmount || 0), 0);
  const totalProjectedProfit = activeLoans.reduce((sum, l) => sum + (l.stats?.projectedProfit || 0), 0);
  const totalCollectedProfit = loans.reduce((sum, l) => sum + (l.stats?.paidAmount || 0), 0);
  const morosoLoans = activeLoans.filter(l => l.status === 'moroso');
  const proximoLoans = activeLoans.filter(l => l.status === 'proximo');
  const activeDebtorsCount = new Set(activeLoans.map(l => l.clientId)).size;
  const morosoDebtorsCount = new Set(morosoLoans.map(l => l.clientId)).size;

  // File Upload & OCR Handler
  const MAX_OCR_FILE_BYTES = 4 * 1024 * 1024; // Vercel limita el body a 4.5 MB

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!String(file.type || '').startsWith('image/')) {
      notify('Selecciona una imagen válida (PNG, JPG o JPEG) del comprobante.', 'error');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_OCR_FILE_BYTES) {
      notify(`La imagen pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB y supera el máximo de 4 MB. Comprímela o recórtala antes de subirla.`, 'error');
      e.target.value = '';
      return;
    }

    setOcrForm(prev => {
      if (prev.filePreview) {
        try { URL.revokeObjectURL(prev.filePreview); } catch {}
      }
      return {
        ...prev,
        file,
        filePreview: URL.createObjectURL(file),
        ocrExtracted: null
      };
    });
  };

  const handleProcessOcrAndSave = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    if (checkIsExpired(currentUser)) {
      notify(SUPPORT_CONTACT_TEXT, 'error');
      return;
    }

    if (!ocrForm.file) {
      notify('Por favor adjunta un comprobante o capture', 'error');
      return;
    }

    setOcrForm(prev => ({ ...prev, processing: true }));

    // Evita que el botón quede en "Analizando..." indefinidamente si Vercel
    // corta la función (504) o la red se estanca.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 75000);

    try {
      const formData = new FormData();
      formData.append('type', ocrForm.type); // 'venta_usdt' | 'compra_usdt'
      if (dolarRates?.oficial) {
        formData.append('bcvRate', dolarRates.oficial.toString());
      }
      if (ocrForm.reference) formData.append('reference', ocrForm.reference);
      if (ocrForm.date) formData.append('date', ocrForm.date);
      if (ocrForm.file) formData.append('receiptFile', ocrForm.file);

      const res = await fetch('/api/ecommerce', {
        method: 'POST',
        headers: {
          'x-user-id': currentUser.id
        },
        body: formData,
        signal: controller.signal
      });

      // Vercel puede devolver HTML/texto plano en 413/504; no asumir JSON.
      const rawBody = await res.text();
      let data = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        data = null;
      }

      if (!data) {
        const fallback = res.status === 413
          ? 'El comprobante supera el tamaño máximo permitido por el servidor (4 MB). Reduce la imagen e inténtalo de nuevo.'
          : res.status === 504
            ? 'El servidor tardó demasiado en procesar el comprobante. Intenta con una imagen más ligera o cambia el proveedor OCR en Ajustes.'
            : `El servidor no devolvió una respuesta válida (HTTP ${res.status}). Inténtalo de nuevo.`;
        notify(fallback, 'error');
        return;
      }

      if (data.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }

      if (data.success) {
        notify('¡Comprobante procesado y registrado con éxito!');
        setOcrForm({
          type: 'venta_usdt',
          reference: '',
          date: new Date().toISOString().split('T')[0],
          file: null,
          filePreview: null,
          processing: false,
          ocrExtracted: data.ocr?.data || null
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchAllData();
      } else {
        notify(data.error || 'Error al procesar el comprobante', 'error');
        if (data.ocr?.data) {
          setOcrForm(prev => ({ ...prev, ocrExtracted: data.ocr.data }));
        }
      }
    } catch (err) {
      console.error(err);
      if (err?.name === 'AbortError') {
        notify('El escaneo OCR superó el tiempo máximo de espera. Intenta con una imagen más ligera o cambia el proveedor OCR en Ajustes.', 'error');
      } else {
        notify('Error de red al procesar el comprobante. Revisa tu conexión e inténtalo de nuevo.', 'error');
      }
    } finally {
      clearTimeout(timeoutId);
      setOcrForm(prev => ({ ...prev, processing: false }));
    }
  };

  // Eliminar transacción individual de comercio electrónico
  const handleDeleteEcommerceTransaction = async (id) => {
    if (!currentUser) return;
    if (checkIsExpired(currentUser)) {
      notify(SUPPORT_CONTACT_TEXT, 'error');
      return;
    }
    if (!confirm('¿Estás seguro de que deseas eliminar este registro de transacción?')) return;

    try {
      const res = await fetch(`/api/ecommerce?id=${id}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': currentUser.id
        }
      });
      const data = await res.json();
      if (data.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }
      if (data.success) {
        notify('Transacción eliminada con éxito');
        fetchAllData();
      } else {
        notify(data.error || 'Error al eliminar', 'error');
      }
    } catch (err) {
      notify('Error al comunicarse con el servidor', 'error');
    }
  };

  const handleCapitalMovementSave = async () => {
    const { type, amount, notes } = capitalModal;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      notify('Ingresa un monto mayor a 0', 'error');
      return;
    }
    const amountUsdFixed = Math.round(Number(amount) * 100) / 100;
    if (amountUsdFixed <= 0) {
      notify('El monto debe ser mayor a 0 USD', 'error');
      return;
    }
    setCapitalModal(prev => ({ ...prev, loading: true }));
    const sessionUserId = currentUser?.id || (() => {
      try {
        return JSON.parse(localStorage.getItem('crediflux_user') || localStorage.getItem('ricardo_user') || '{}')?.id || '';
      } catch (e) {
        return '';
      }
    })();
    try {
      const resp = await fetch('/api/capital-movements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': sessionUserId
        },
        body: JSON.stringify({
          type,
          currencyOrigin: 'USD',
          amount: amountUsdFixed,
          notes
        })
      });
      const data = await resp.json();
      if (data.success) {
        notify(type === 'APORTE_CAPITAL' ? '¡Aporte de capital registrado con éxito!' : '¡Retiro de capital procesado con éxito!');
        setCapitalModal(prev => ({ ...prev, open: false, amount: '', notes: '' }));
        fetchAllData();
      } else {
        notify(data.error || 'Error al registrar movimiento de capital', 'error');
      }
    } catch (err) {
      console.error('Error saving capital movement:', err);
      notify('Error de red al guardar movimiento', 'error');
    } finally {
      setCapitalModal(prev => ({ ...prev, loading: false }));
    }
  };

  const handleDeleteCapitalMovement = async (id) => {
    if (!confirm('¿Eliminar este registro de movimiento de capital? Esta acción recalculará el patrimonio neto.')) return;
    try {
      const resp = await fetch(`/api/capital-movements?id=${id}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': currentUser?.id || ''
        }
      });
      const data = await resp.json();
      if (data.success) {
        notify('Movimiento de capital eliminado');
        fetchAllData();
      } else {
        notify(data.error || 'No se pudo eliminar el movimiento', 'error');
      }
    } catch (err) {
      notify('Error al comunicarse con el servidor', 'error');
    }
  };

  // Crear o guardar patrón de comprobante (Admin)
  const handleSaveReceiptPattern = async (e) => {
    e.preventDefault();
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!patternForm.bankName.trim()) {
      notify('El nombre del banco emisor es obligatorio', 'error');
      return;
    }

    setPatternForm(prev => ({ ...prev, processing: true }));
    try {
      const fd = new FormData();
      fd.append('bankName', patternForm.bankName);
      if (patternForm.referenceFormat) fd.append('referenceFormat', patternForm.referenceFormat);
      if (patternForm.keywords) fd.append('keywords', patternForm.keywords);
      if (patternForm.notes) fd.append('notes', patternForm.notes);
      if (patternForm.file) fd.append('patternImage', patternForm.file);

      const res = await fetch('/api/receipt-patterns', {
        method: 'POST',
        headers: {
          'x-user-id': currentUser.id
        },
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        notify('Patrón de comprobante registrado para validación cruzada');
        setPatternModal(false);
        setPatternForm({
          bankName: '',
          referenceFormat: '',
          keywords: '',
          notes: '',
          file: null,
          filePreview: null,
          processing: false
        });
        if (patternFileInputRef.current) patternFileInputRef.current.value = '';
        fetchAllData();
      } else {
        notify(data.error || 'Error al guardar patrón', 'error');
        setPatternForm(prev => ({ ...prev, processing: false }));
      }
    } catch (err) {
      notify('Error al conectar con el servidor', 'error');
      setPatternForm(prev => ({ ...prev, processing: false }));
    }
  };

  // Eliminar patrón de comprobante (Admin)
  const handleDeleteReceiptPattern = async (id) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!confirm('¿Deseas eliminar este patrón de validación cruzada?')) return;

    try {
      const res = await fetch(`/api/receipt-patterns?id=${id}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': currentUser.id
        }
      });
      const data = await res.json();
      if (data.success) {
        notify('Patrón eliminado correctamente');
        fetchAllData();
      } else {
        notify(data.error || 'Error al eliminar patrón', 'error');
      }
    } catch (err) {
      notify('Error de red al eliminar', 'error');
    }
  };

  // Quick Pay Modal Handler
  const handleRegisterPayment = async (e) => {
    e.preventDefault();
    if (checkIsExpired(currentUser)) {
      notify(SUPPORT_CONTACT_TEXT, 'error');
      return;
    }

    const formData = new FormData(e.currentTarget);
    const loanId = quickPayModal.loan.id;
    const installmentNumber = formData.get('installmentNumber');
    const amount = formData.get('amount');
    const method = formData.get('method');
    const reference = formData.get('reference');
    const payAll = installmentNumber === 'all';

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({
          loanId,
          installmentNumber: payAll ? undefined : installmentNumber,
          amount,
          method,
          reference,
          payAll,
          bcvRate: dolarRates?.oficial || undefined
        })
      });
      const data = await res.json();
      if (data.licenseExpired) {
        notify(SUPPORT_CONTACT_TEXT, 'error');
        return;
      }
      if (data.success) {
        notify(data.message);
        setQuickPayModal({ open: false, loan: null });
        setQuickPaySelection('');
        fetchAllData();
      } else {
        notify(data.error || 'Error al registrar el abono', 'error');
      }
    } catch (err) {
      notify('Error al procesar abono', 'error');
    }
  };

  const isUserExpired = checkIsExpired(currentUser);
  const licenseProgress = calculateLicenseProgress(currentUser);

  // Meses del año para la gestión mensual
  const monthLabels = [
    { num: 1, name: "Enero" }, { num: 2, name: "Febrero" }, { num: 3, name: "Marzo" },
    { num: 4, name: "Abril" }, { num: 5, name: "Mayo" }, { num: 6, name: "Junio" },
    { num: 7, name: "Julio" }, { num: 8, name: "Agosto" }, { num: 9, name: "Septiembre" },
    { num: 10, name: "Octubre" }, { num: 11, name: "Noviembre" }, { num: 12, name: "Diciembre" }
  ];

  // --- RENDER LOGIN SCREEN (ESTRICTAMENTE PRIVADA - SIN REGISTRO PÚBLICO) ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#0b1120] via-[#0f172a] to-[#064e3b]">
        <div className="w-full max-w-md bg-[#111827]/95 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/25 mb-3">
              <Shield className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center justify-center gap-1.5">
              <span>CREDI</span>
              <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">FLUX</span>
            </h1>
            <p className="text-[11px] uppercase tracking-widest text-emerald-400 font-bold mt-0.5">
              Plataforma SaaS Financiera & E-Commerce
            </p>
            <p className="text-slate-400 text-xs mt-1">
              Ingresa tus credenciales autorizadas por el Administrador.
            </p>
          </div>

          {authError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* FORMULARIO ÚNICO DE INICIO DE SESIÓN (Registro público removido) */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Usuario
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="admin o usuario asignado"
                  value={loginInput.username}
                  onChange={(e) => setLoginInput({ ...loginInput, username: e.target.value })}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                suppressHydrationWarning
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Clave de Acceso
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="Contraseña"
                  value={loginInput.password}
                  onChange={(e) => setLoginInput({ ...loginInput, password: e.target.value })}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                suppressHydrationWarning
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-3 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 text-xs"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Iniciar Sesión Segura</span>
            </button>
          </form>

          <div className="mt-8 pt-4 border-t border-slate-800 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Acceso Restringido • Registro Solo por Administrador
            </span>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN AUTHENTICATED FINTECH DASHBOARD ---

  // ---- Sistema tipográfico unificado del módulo de Ajustes ----
  const settingsCardTheme = themeDark ? 'bg-[#111827] border-slate-800' : 'bg-white border-slate-200';
  const settingsCardCls = `p-5 rounded-2xl border ${settingsCardTheme}`;
  const settingsSubcardTheme = themeDark ? 'bg-[#1e293b]/50 border-slate-700/60' : 'bg-slate-50 border-slate-200';
  const settingsTitleCls = 'text-base font-semibold text-white flex items-center gap-2';
  const settingsCardTitleCls = 'text-sm font-semibold text-white flex items-center gap-2';
  const settingsDescCls = 'text-xs text-slate-400 leading-relaxed';
  const settingsLabelCls = 'block text-xs font-medium text-slate-300 mb-1.5';
  const settingsInputCls = 'w-full h-10 px-3 bg-[#0b1120] border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50';
  const settingsTextareaCls = 'w-full px-3 py-2 bg-[#0b1120] border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none';
  const settingsPrimaryBtnCls = 'h-10 px-4 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-sm transition-colors shadow-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
  const settingsSecondaryBtnCls = 'h-10 px-4 bg-[#1f2937] hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold rounded-lg text-sm transition-colors inline-flex items-center justify-center gap-1.5';
  const settingsDangerBtnCls = 'h-10 px-4 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold rounded-lg text-sm transition-colors inline-flex items-center justify-center gap-1.5';
  const settingsHelperCls = 'text-[11px] text-slate-500 leading-relaxed';
  const settingsTableHeadCls = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400';
  const settingsTableBtnCls = 'h-8 px-3 bg-[#1f2937] hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors';
  const settingsTableDangerBtnCls = 'h-8 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-colors';

  return (
    <div className={`min-h-screen ${themeDark ? 'bg-[#0b1120] text-slate-100' : 'bg-[#f8fafc] text-slate-900'} flex flex-col transition-colors duration-200`}>
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-5 right-5 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border text-xs font-semibold transition-all max-w-md ${notification.type === 'error'
          ? 'bg-rose-950/95 border-rose-500 text-rose-200'
          : 'bg-emerald-950/95 border-emerald-500 text-emerald-200'
          }`}>
          {notification.type === 'error' ? <AlertTriangle className="w-5 h-5 shrink-0" /> : <CheckCircle className="w-5 h-5 shrink-0" />}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* BANNER DE LICENCIA CADUCADA */}
      {isUserExpired && (
        <div className="bg-rose-600 text-white px-4 py-2.5 text-xs font-medium flex flex-col sm:flex-row items-center justify-between gap-2 shadow-lg">
          <div className="flex items-center gap-2 text-center sm:text-left">
            <AlertCircle className="w-5 h-5 shrink-0 animate-bounce" />
            <span>
              <strong>Licencia del sistema caducada.</strong> Modo solo lectura activo. Para renovar contacte a soporte (+584126770824 | Oswaldoserrano18@gmail.com)
            </span>
          </div>
          <button
            onClick={() => setActiveTab('settings')}
            className="px-3 py-1 bg-white text-rose-700 font-bold rounded-lg text-xs hover:bg-slate-100 shrink-0"
          >
            Renovar Licencia Aquí
          </button>
        </div>
      )}

      {/* TOPBAR NAVIGATION */}
      <header className={`border-b sticky top-0 z-30 backdrop-blur-md ${themeDark ? 'bg-[#0b1120]/90 border-slate-800/80' : 'bg-white/90 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/25 ring-1 ring-emerald-400/30">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-black text-xl tracking-tight text-white">CREDI</span>
                <span className="font-black text-xl tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">FLUX</span>
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">PRO</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isUserExpired ? 'bg-rose-500' : 'bg-emerald-400'}`}></span>
                <span className="text-[11px] font-medium text-slate-400 tracking-wide uppercase">
                  {currentUser?.role === 'admin' ? 'Administrador Maestro (Acceso Total)' : isUserExpired ? 'Licencia Caducada' : 'Licencia Activa'}
                </span>
              </div>
            </div>
          </div>

          {/* Top Actions: Tasas BCV + P2P Binance, Refresh, Theme, User badge, Logout */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Widget de tasas: BCV oficial (dolarapi.com) y promedio P2P Binance (VES/USDT) */}
            <div className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-semibold ${themeDark ? 'bg-slate-800/90 border-slate-700/80' : 'bg-slate-100 border-slate-200'
              }`}>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-[11px] font-bold text-emerald-400 tracking-wide">USD</span>
              </div>
              <div className="h-3 w-px bg-slate-700/60 hidden sm:block"></div>
              {dolarRates.loading && !dolarRates.oficial && !dolarRates.p2pAverage ? (
                <span className="text-[11px] text-slate-400 animate-pulse">Cargando...</span>
              ) : (
                <div className="flex items-center gap-2 sm:gap-3 text-[11px] flex-wrap">
                  {dolarRates.oficial && (
                    <div className="flex items-center gap-1" title="Tasa Dólar Oficial BCV (dolarapi.com)">
                      <span className="text-slate-400 text-[10px]">BCV:</span>
                      <span className="font-bold text-white font-mono">
                        {dolarRates.oficial.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {dolarRates.p2pAverage && (
                    <div
                      className="flex items-center gap-1"
                      title={`Promedio P2P Binance (VES/USDT)${
                        dolarRates.p2pBuy && dolarRates.p2pSell
                          ? ` · Compra: ${dolarRates.p2pBuy.toFixed(2)} · Venta: ${dolarRates.p2pSell.toFixed(2)}`
                          : ''
                      }${
                        dolarRates.p2pUpdatedAt
                          ? ` · Actualizado: ${new Date(dolarRates.p2pUpdatedAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`
                          : ''
                      }`}
                    >
                      <span className="text-slate-400 text-[10px]">P2P:</span>
                      <span className="font-bold text-amber-300 font-mono">
                        {dolarRates.p2pAverage.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {!dolarRates.oficial && !dolarRates.p2pAverage && (
                    <span className="text-[10px] text-slate-400">BCV · Binance P2P</span>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => fetchAllData({ forceP2P: true })}
              title="Sincronizar datos y tasas (BCV + P2P Binance)"
              className={`p-2 rounded-xl border ${themeDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'}`}
            >
              <RefreshCw className={`w-4 h-4 ${loading || dolarRates.loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={toggleTheme}
              title="Cambiar tema"
              className={`p-2 rounded-xl border ${themeDark ? 'bg-slate-800 border-slate-700 text-amber-400' : 'bg-slate-100 border-slate-200 text-slate-700'}`}
            >
              {themeDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${currentUser?.role === 'admin'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : themeDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}>
              <User className="w-3.5 h-3.5 text-emerald-400" />
              <span>{currentUser?.name || 'Usuario'}</span>
              {currentUser?.role === 'admin' && (
                <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded text-[9px] font-bold">ADMIN</span>
              )}
            </div>

            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex overflow-x-auto gap-1 border-t border-slate-800/40 no-scrollbar py-1">
          {[
            { id: 'dashboard', label: 'Dashboard General', icon: TrendingUp },
            { id: 'loans', label: 'Financiamientos y Deudas', icon: CreditCard, badge: morosoLoans.length > 0 ? morosoLoans.length : null },
            { id: 'clients', label: 'Clientes', icon: Users },
            { id: 'products', label: 'Productos', icon: Smartphone },
            { id: 'ecommerce', label: 'E-Commerce & OCR IA', icon: ShoppingBag, badge: 'IA' },
            { id: 'settings', label: currentUser?.role === 'admin' ? 'Ajustes Admin (CrediFlux)' : 'Mi Cuenta & Licencia', icon: Lock }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${active
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab.badge === 'IA' ? 'bg-teal-500/20 text-teal-300' : 'bg-rose-500 text-white'
                    }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* MAIN VIEW CONTENT CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* ============================================================== */}
        {/* TAB 1: DASHBOARD GENERAL (RESUMEN FINANCIERO Y OPERATIVO)      */}
        {/* ============================================================== */}
        {activeTab === 'dashboard' && (() => {
          const bcvRate = Number(dolarRates?.oficial) || 0;
          const toBs = (usd) => (Number(usd) || 0) * bcvRate;
          const fmtUsd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const fmtBs = (n) => `Bs ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          // --- Filtros cronológicos (dashboard) ---
          const now = new Date();
          const currentMonthKey = now.toISOString().slice(0, 7);
          const currentYearStr = String(now.getFullYear());
          const inDashPeriod = (dateLike) => {
            if (!dateLike) return false;
            const dStr = String(dateLike).slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}/.test(dStr)) return false;
            if (dashPeriodMode === 'month') return dStr.startsWith(dashMonth || currentMonthKey);
            if (dashPeriodMode === 'year') return dStr.startsWith(dashYear || currentYearStr);
            if (dashPeriodMode === 'range') {
              if (dashDateFrom && dStr < dashDateFrom) return false;
              if (dashDateTo && dStr > dashDateTo) return false;
              return Boolean(dashDateFrom || dashDateTo);
            }
            return true;
          };
          const dashPeriodLabel = (() => {
            if (dashPeriodMode === 'month') {
              const [y, m] = (dashMonth || currentMonthKey).split('-');
              const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
              return `${names[(Number(m) || 1) - 1] || dashMonth} ${y}`;
            }
            if (dashPeriodMode === 'year') return `Año ${dashYear || currentYearStr}`;
            if (dashPeriodMode === 'range') {
              if (dashDateFrom && dashDateTo) return `Desde ${dashDateFrom} hasta ${dashDateTo}`;
              if (dashDateFrom) return `Desde ${dashDateFrom}`;
              if (dashDateTo) return `Hasta ${dashDateTo}`;
              return 'Rango personalizado';
            }
            return 'Período';
          })();

          const filteredPayments = (payments || []).filter(p => inDashPeriod(p.date || p.createdAt));
          const filteredEcomTxs = (ecommerceData.transactions || []).filter(t => inDashPeriod(t.date || t.createdAt));
          const filteredLoansMoney = (loans || []).filter(l => l && l.type === 'dinero' && inDashPeriod(l.createdAt || l.startDate));

          const monthsOfYear = [
            { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' }, { v: '04', l: 'Abril' },
            { v: '05', l: 'Mayo' }, { v: '06', l: 'Junio' }, { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' },
            { v: '09', l: 'Septiembre' }, { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' }
          ];
          const selectedMonthNum = (dashMonth || currentMonthKey).split('-')[1] || '01';
          const selectedMonthYear = (dashMonth || currentMonthKey).split('-')[0] || currentYearStr;

          // --- Salidas / Egresos operativos ---
          // Auditoría contable: el capital inyectado (patrimonio) y el dinero prestado
          // (colocación recuperable) NO son gastos operativos, por lo que se excluyen
          // de los egresos totales y se muestran por separado como colocaciones.
          const egresoInventarioUsd = (products || []).reduce((sum, p) => sum + (Number(p.costPrice) || 0) * (Number(p.stock) || 0), 0);
          const egresoComprasEcomUsd = filteredEcomTxs
            .filter(t => t.type === 'compra')
            .reduce((sum, t) => sum + (Number(t.amountUSD) || 0), 0);
          const egresoComprasEcomBs = filteredEcomTxs
            .filter(t => t.type === 'compra')
            .reduce((sum, t) => sum + (Number(t.amountBs) || (bcvRate ? (Number(t.amountUSD) || 0) * bcvRate : 0)), 0);
          const egresos = [
            { label: 'Compras de inventario (operativas)', usd: egresoInventarioUsd, bs: toBs(egresoInventarioUsd), note: 'Stock actual' },
            { label: 'Compras operativas de e-commerce', usd: egresoComprasEcomUsd, bs: egresoComprasEcomBs, note: 'Período' }
          ];
          const totalEgresosUsd = egresos.reduce((s, i) => s + i.usd, 0);
          const totalEgresosBs = egresos.reduce((s, i) => s + i.bs, 0);

          // Colocaciones: salidas recuperables que no forman parte del gasto operativo.
          const colocacionCapitalEcomUsd = Number(ecommerceData.summary?.assignedCapital) || 0;
          const colocacionPrestamosUsd = filteredLoansMoney
            .reduce((sum, l) => sum + (Number(l.principal ?? l.financedAmount) || 0), 0);

          // --- Entradas / Ingresos (Bs) ---
          const ingresoPagosFinBs = filteredPayments.reduce((sum, p) => {
            const usd = Number(p.amount) || 0;
            const rate = Number(p.bcvRate) || bcvRate;
            const bs = p.amountBs != null ? Number(p.amountBs) : (rate > 0 ? usd * rate : 0);
            return sum + (Number.isFinite(bs) ? bs : 0);
          }, 0);
          const ingresoVentasEcomBs = filteredEcomTxs
            .filter(t => t.type === 'venta')
            .reduce((sum, t) => sum + (Number(t.amountBs) || (bcvRate ? (Number(t.amountUSD) || 0) * bcvRate : 0)), 0);
          const totalEntradasBs = ingresoPagosFinBs + ingresoVentasEcomBs;
          const ingresoPagosFinUsd = filteredPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

          // --- Ganancias netas ---
          const loansById = (loans || []).reduce((acc, l) => { acc[l.id] = l; return acc; }, {});
          const gananciaFinUsd = filteredPayments.reduce((sum, p) => {
            const loan = loansById[p.loanId];
            if (!loan) return sum;
            const total = Number(loan.totalAmount) || 0;
            const projected = Number(loan.stats?.projectedProfit) || 0;
            if (total <= 0 || projected <= 0) return sum;
            return sum + (Number(p.amount) || 0) * (projected / total);
          }, 0);
          const gananciaFinBs = toBs(gananciaFinUsd);
          const ecomVentasUsdPeriodo = filteredEcomTxs.filter(t => t.type === 'venta').reduce((s, t) => s + (Number(t.amountUSD) || 0), 0);
          const ecomVentasBsPeriodo = filteredEcomTxs.filter(t => t.type === 'venta').reduce((s, t) => s + (Number(t.amountBs) || 0), 0);
          const gananciaEcomUsd = ecomVentasUsdPeriodo - egresoComprasEcomUsd;
          const gananciaEcomBs = ecomVentasBsPeriodo - egresoComprasEcomBs;
          const totalGananciasUsd = gananciaFinUsd + gananciaEcomUsd;
          const totalGananciasBs = gananciaFinBs + gananciaEcomBs;

          // --- KPIs principales (jerarquía financiera) ---
          const entradasPeriodoUsd = ingresoPagosFinUsd + ecomVentasUsdPeriodo;
          const flujoNetoUsd = entradasPeriodoUsd - totalEgresosUsd;
          const roiGlobal = capitalSummary.netCapital > 0
            ? (totalGananciasUsd / capitalSummary.netCapital) * 100
            : 0;
          const activeLoansKpi = (loans || []).filter(l => l && !l.archived && l.status !== 'completado' && l.status !== 'archivado');
          const carteraActivaUsd = activeLoansKpi.reduce((sum, l) => sum + (Number(l.stats?.pendingAmount) || 0), 0);

          // --- Datos del módulo "Gestionar Capital" ---
          const recentCapitalMovements = (capitalMovements || []).slice(0, 6);
          const monthNameFor = (dateLike) => {
            const d = new Date(dateLike || 0);
            if (Number.isNaN(d.getTime())) return '—';
            return `${monthLabels[d.getMonth()]?.name || ''} ${d.getFullYear()}`.trim();
          };

          const urgentCount = morosoLoans.length + proximoLoans.length;
          const card = `rounded-3xl border ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'} shadow-sm`;
          const periodInputCls = 'px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 outline-none focus:border-emerald-500';

          return (
          <div className="space-y-6">
            {/* Filtros cronológicos */}
            <div className={`${card} p-4`}>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight">Filtros cronológicos</h2>
                  <p className="text-[11px] text-slate-400">Segmenta el resumen financiero y los indicadores del dashboard. Período activo: <span className="text-emerald-400 font-medium">{dashPeriodLabel}</span></p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={dashPeriodMode}
                    onChange={(e) => {
                      const m = e.target.value;
                      setDashPeriodMode(m);
                      if (m === 'month' && !dashMonth) setDashMonth(currentMonthKey);
                      if (m === 'year' && !dashYear) setDashYear(currentYearStr);
                    }}
                    className={periodInputCls}
                  >
                    <option value="month">Mes específico</option>
                    <option value="year">Vista anual</option>
                    <option value="range">Rango personalizado</option>
                  </select>

                  {dashPeriodMode === 'month' && (
                    <>
                      <select
                        value={selectedMonthNum}
                        onChange={(e) => setDashMonth(`${selectedMonthYear}-${e.target.value}`)}
                        className={periodInputCls}
                      >
                        {monthsOfYear.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select>
                      <select
                        value={selectedMonthYear}
                        onChange={(e) => setDashMonth(`${e.target.value}-${selectedMonthNum}`)}
                        className={periodInputCls}
                        title="Año"
                      >
                        {Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - 4 + i)).map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </>
                  )}

                  {dashPeriodMode === 'year' && (
                    <>
                      <select
                        value={dashYear}
                        onChange={(e) => setDashYear(e.target.value)}
                        className={periodInputCls}
                      >
                        {Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - 4 + i)).map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { setDashPeriodMode('year'); setDashYear(currentYearStr); }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/20"
                      >
                        Año actual
                      </button>
                    </>
                  )}

                  {dashPeriodMode === 'range' && (
                    <>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>Desde</span>
                        <input type="date" value={dashDateFrom} onChange={(e) => setDashDateFrom(e.target.value)} className={periodInputCls} />
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>Hasta</span>
                        <input type="date" value={dashDateTo} onChange={(e) => setDashDateTo(e.target.value)} className={periodInputCls} />
                      </label>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Alertas urgentes */}
            {urgentCount > 0 && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-amber-200 text-sm">Alertas de pagos</h4>
                    <p className="text-slate-400 text-xs">
                      <strong className="text-rose-400">{morosoLoans.length} en mora</strong> y{' '}
                      <strong className="text-amber-400">{proximoLoans.length} próximos a vencer</strong> (≤ 72 h).
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setActiveTab('loans'); setDebtorStatusFilter('moroso'); }}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-xs transition-all shadow-md"
                >
                  Ver cartera de cobro
                </button>
              </div>
            )}

            {/* KPIs principales: jerarquía financiera */}
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Liquidez / Capital disponible */}
              <div className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Liquidez / Capital disponible</p>
                    <h3 className="mt-1 text-2xl font-extrabold text-white tabular-nums truncate">{fmtUsd(capitalSummary.netCapital)}</h3>
                    <p className="mt-1 text-[11px] text-slate-400">Capital invertido neto (aportes − retiros)</p>
                  </div>
                  <span className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0"><Landmark className="w-5 h-5" /></span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Aportes {fmtUsd(capitalSummary.aportes)}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20">Retiros {fmtUsd(capitalSummary.retiros)}</span>
                </div>
              </div>

              {/* Flujo del período */}
              <div className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Flujo del período</p>
                    <h3 className={`mt-1 text-2xl font-extrabold tabular-nums truncate ${flujoNetoUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {flujoNetoUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(flujoNetoUsd))}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-400">Entradas {fmtUsd(entradasPeriodoUsd)} − Egresos {fmtUsd(totalEgresosUsd)}</p>
                  </div>
                  <span className={`p-2.5 rounded-xl shrink-0 ${flujoNetoUsd >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {flujoNetoUsd >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                  </span>
                </div>
                <p className="mt-3 text-[10px] text-slate-500">{dashPeriodLabel} • solo egresos operativos</p>
              </div>

              {/* Rendimiento / Ganancias */}
              <div className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rendimiento / Ganancias</p>
                    <h3 className={`mt-1 text-2xl font-extrabold tabular-nums truncate ${totalGananciasUsd >= 0 ? 'text-teal-400' : 'text-rose-400'}`}>{fmtUsd(totalGananciasUsd)}</h3>
                    <p className="mt-1 text-[11px] text-slate-400">Ganancias netas del período</p>
                  </div>
                  <span className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 shrink-0"><TrendingUp className="w-5 h-5" /></span>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                  <span>ROI sobre capital</span>
                  <span className={`font-bold tabular-nums ${roiGlobal >= 0 ? 'text-teal-300' : 'text-rose-300'}`}>{roiGlobal.toFixed(2)} %</span>
                </div>
              </div>

              {/* Cartera activa */}
              <div className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Cartera activa</p>
                    <h3 className="mt-1 text-2xl font-extrabold text-white tabular-nums truncate">{fmtUsd(carteraActivaUsd)}</h3>
                    <p className="mt-1 text-[11px] text-slate-400">Saldo por cobrar de financiamientos</p>
                  </div>
                  <span className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0"><Wallet className="w-5 h-5" /></span>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{activeLoansKpi.length} financiamiento(s) activo(s)</span>
                  <button onClick={() => setActiveTab('loans')} className="font-semibold text-emerald-400 hover:text-emerald-300">Ver cartera →</button>
                </div>
              </div>
            </section>

            {/* Bloque: Resumen financiero */}
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <h2 className="text-lg font-bold text-white tracking-tight">Resumen Financiero</h2>
                <span className="text-[11px] text-slate-400">Período: {dashPeriodLabel} • BCV: {bcvRate ? fmtBs(bcvRate).replace('Bs ', '') + ' Bs/USD' : '—'}</span>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* Salidas */}
                <div className={`${card} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Solo gastos operativos</p>
                      <h3 className="text-base font-bold text-white">Egresos totales</h3>
                    </div>
                    <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400"><ArrowDownRight className="w-5 h-5" /></span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] text-slate-400">Total USD</p>
                      <p className="text-lg font-extrabold text-white tabular-nums">{fmtUsd(totalEgresosUsd)}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] text-slate-400">Total Bs</p>
                      <p className="text-lg font-extrabold text-rose-300 tabular-nums">{fmtBs(totalEgresosBs)}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {egresos.map((item) => (
                      <div key={item.label} className="p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/20">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-medium text-slate-300 leading-snug">{item.label}</p>
                          {item.note && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">{item.note}</span>}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-semibold text-white tabular-nums">{fmtUsd(item.usd)}</span>
                          <span className="text-slate-400 tabular-nums">{fmtBs(item.bs)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] text-slate-500 leading-relaxed">El capital invertido y los financiamientos otorgados no se incluyen: son recuperables y no representan gasto operativo.</p>
                </div>

                {/* Entradas */}
                <div className={`${card} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total de dinero de entrada</p>
                      <h3 className="text-base font-bold text-white">Ingresos totales (Bs)</h3>
                    </div>
                    <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400"><ArrowUpRight className="w-5 h-5" /></span>
                  </div>
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-3">
                    <p className="text-[10px] text-emerald-300/80 uppercase tracking-wider font-semibold">Consolidado en bolívares</p>
                    <p className="mt-1 text-2xl font-extrabold text-white tabular-nums">{fmtBs(totalEntradasBs)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Equivalente: {fmtUsd(bcvRate ? totalEntradasBs / bcvRate : 0)} • Pagos USD: {fmtUsd(ingresoPagosFinUsd)}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/20 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-medium text-slate-300">Pagos de financiamientos recibidos</p>
                        <p className="text-[10px] text-slate-500">Abonos y capitalización ({filteredPayments.length} pago{filteredPayments.length === 1 ? '' : 's'})</p>
                      </div>
                      <p className="text-sm font-bold text-emerald-400 tabular-nums">{fmtBs(ingresoPagosFinBs)}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/20 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-medium text-slate-300">Ventas de e-commerce</p>
                        <p className="text-[10px] text-slate-500">Ingresos registrados en el período</p>
                      </div>
                      <p className="text-sm font-bold text-emerald-400 tabular-nums">{fmtBs(ingresoVentasEcomBs)}</p>
                    </div>
                  </div>
                </div>

                {/* Ganancias */}
                <div className={`${card} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rentabilidad</p>
                      <h3 className="text-base font-bold text-white">Total de ganancias netas</h3>
                    </div>
                    <span className="p-2 rounded-xl bg-teal-500/10 text-teal-400"><TrendingUp className="w-5 h-5" /></span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
                      <p className="text-[10px] text-slate-400">Total USD</p>
                      <p className="text-lg font-extrabold text-teal-400 tabular-nums">{fmtUsd(totalGananciasUsd)}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
                      <p className="text-[10px] text-slate-400">Total Bs</p>
                      <p className="text-lg font-extrabold text-white tabular-nums">{fmtBs(totalGananciasBs)}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/20">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-slate-300">Margen de ganancia de financiamientos</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Realizada</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className="font-bold text-emerald-400 tabular-nums">{fmtUsd(gananciaFinUsd)}</span>
                        <span className="text-slate-400 tabular-nums">{fmtBs(gananciaFinBs)}</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/20">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-slate-300">Margen de ganancia de e-commerce</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">Ventas − Compras</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className="font-bold text-purple-300 tabular-nums">{fmtUsd(gananciaEcomUsd)}</span>
                        <span className="text-slate-400 tabular-nums">{fmtBs(gananciaEcomBs)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Bloque: Capital operativo */}
            <section className={`${card} p-5`}>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    <Coins className="w-5 h-5 text-emerald-400" />
                    Capital operativo
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">Aportes y retiros de capital. El capital es patrimonio, no un egreso operativo.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => { if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; } setCapitalModal(prev => ({ ...prev, open: true, tab: 'movimiento' })); }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20"
                    aria-label="Gestionar Capital"
                  >
                    <Coins className="w-4 h-4" /> Gestionar Capital
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Capital invertido neto</p>
                  <p className="mt-1 text-xl font-extrabold text-white tabular-nums">{fmtUsd(capitalSummary.netCapital)}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{capitalSummary.count} movimiento(s) registrado(s)</p>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-950/20">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Aportes acumulados</p>
                  <p className="mt-1 text-xl font-extrabold text-emerald-400 tabular-nums">{fmtUsd(capitalSummary.aportes)}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Inyecciones de patrimonio</p>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-950/20">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Retiros acumulados</p>
                  <p className="mt-1 text-xl font-extrabold text-rose-400 tabular-nums">{fmtUsd(capitalSummary.retiros)}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Desinversiones de capital</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
                <div className="lg:col-span-2 rounded-xl border border-slate-800/80 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">Movimientos recientes</span>
                    <button onClick={() => setCapitalModal(prev => ({ ...prev, open: true, tab: 'historial' }))} className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300">Ver historial completo →</button>
                  </div>
                  {recentCapitalMovements.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <p className="text-xs text-slate-400">Aún no hay aportes ni retiros de capital registrados.</p>
                      <button onClick={() => setCapitalModal(prev => ({ ...prev, open: true, tab: 'movimiento' }))} className="mt-2 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300">Registrar el primero →</button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-800/30 text-[10px] uppercase tracking-wider text-slate-400">
                          <tr>
                            <th className="text-left py-2 px-3">Fecha</th>
                            <th className="text-left py-2 px-3">Mes</th>
                            <th className="text-left py-2 px-3">Tipo</th>
                            <th className="text-right py-2 px-3">Monto USD</th>
                            <th className="text-left py-2 px-3">Moneda</th>
                            <th className="text-left py-2 px-3">Concepto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentCapitalMovements.map((m) => (
                            <tr key={m.id} className="border-t border-slate-800/70 hover:bg-slate-800/20">
                              <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{new Date(m.createdAt || 0).toLocaleDateString('es-VE')}</td>
                              <td className="py-2 px-3 text-slate-400 whitespace-nowrap">{monthNameFor(m.createdAt)}</td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${m.type === 'APORTE_CAPITAL' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border-rose-500/20'}`}>
                                  {m.type === 'APORTE_CAPITAL' ? 'Aporte' : 'Retiro'}
                                </span>
                              </td>
                              <td className={`py-2 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${m.type === 'APORTE_CAPITAL' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {m.type === 'APORTE_CAPITAL' ? '+' : '−'}{fmtUsd(m.amountUsd)}
                              </td>
                              <td className="py-2 px-3 text-slate-400">{m.currencyOrigin || 'USD'}</td>
                              <td className="py-2 px-3 text-slate-400 max-w-[16rem] truncate" title={m.notes || ''}>{m.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
                  <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> No se contabilizan como egresos</h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">Salidas recuperables o de patrimonio, informativas para el flujo de caja:</p>
                  <div className="mt-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-300">Capital asignado a e-commerce</span>
                      <span className="font-semibold text-amber-300 tabular-nums">{fmtUsd(colocacionCapitalEcomUsd)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-300">Financiamientos otorgados</span>
                      <span className="font-semibold text-amber-300 tabular-nums">{fmtUsd(colocacionPrestamosUsd)}</span>
                    </div>
                  </div>
                  <p className="mt-2.5 text-[10px] text-slate-500">Se recuperan vía pagos de cuotas y ventas; no reducen la utilidad operativa.</p>
                </div>
              </div>
            </section>

            {/* Modal: Gestionar Capital */}
            {capitalModal.open && (
              <div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-6"
                onClick={(e) => { if (e.target === e.currentTarget) setCapitalModal(prev => ({ ...prev, open: false })); }}
                role="dialog"
                aria-modal="true"
                aria-label="Gestionar Capital"
              >
                <div className={`w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl ${themeDark ? 'bg-[#0f172a] border-slate-700/80' : 'bg-white border-slate-200'}`}>
                  <div className={`sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b ${themeDark ? 'bg-[#0f172a] border-slate-800' : 'bg-white border-slate-200'}`}>
                    <div>
                      <h2 className={`text-lg font-bold flex items-center gap-2 ${themeDark ? 'text-white' : 'text-slate-900'}`}><Coins className="w-5 h-5 text-emerald-400" /> Gestionar Capital</h2>
                      <p className="text-[11px] text-slate-400">Registra aportes y retiros, y consulta el historial cronológico del capital.</p>
                    </div>
                    <button
                      onClick={() => setCapitalModal(prev => ({ ...prev, open: false }))}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
                      aria-label="Cerrar modal"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                        <p className="text-[9px] uppercase tracking-wider text-emerald-300/80 font-semibold">Capital neto</p>
                        <p className="text-sm font-extrabold text-white tabular-nums">{fmtUsd(capitalSummary.netCapital)}</p>
                      </div>
                      <div className="p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/20">
                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Aportes</p>
                        <p className="text-sm font-extrabold text-emerald-400 tabular-nums">{fmtUsd(capitalSummary.aportes)}</p>
                      </div>
                      <div className="p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/20">
                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Retiros</p>
                        <p className="text-sm font-extrabold text-rose-400 tabular-nums">{fmtUsd(capitalSummary.retiros)}</p>
                      </div>
                    </div>

                    <div className={`flex gap-1 p-1 rounded-xl border overflow-x-auto no-scrollbar ${themeDark ? 'bg-slate-800/60 border-slate-700/70' : 'bg-slate-100 border-slate-200'}`}>
                      {[
                        { id: 'movimiento', label: 'Movimiento' },
                        { id: 'historial', label: `Historial (${capitalSummary.count})` }
                      ].map((tabItem) => (
                        <button
                          key={tabItem.id}
                          onClick={() => setCapitalModal(prev => ({ ...prev, tab: tabItem.id }))}
                          className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-bold transition-all ${capitalModal.tab === tabItem.id ? 'bg-emerald-500 text-slate-950 shadow-sm' : themeDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                          {tabItem.label}
                        </button>
                      ))}
                    </div>

                    {capitalModal.tab === 'movimiento' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Tipo de movimiento</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setCapitalModal(prev => ({ ...prev, type: 'APORTE_CAPITAL' }))}
                              className={`py-2 rounded-xl text-xs font-bold transition-all border ${capitalModal.type === 'APORTE_CAPITAL' ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-transparent text-slate-400 border-emerald-500/20 hover:text-emerald-300'}`}
                            >
                              Aporte
                            </button>
                            <button
                              onClick={() => setCapitalModal(prev => ({ ...prev, type: 'RETIRO_CAPITAL' }))}
                              className={`py-2 rounded-xl text-xs font-bold transition-all border ${capitalModal.type === 'RETIRO_CAPITAL' ? 'bg-rose-500 text-white border-rose-400' : 'bg-transparent text-slate-400 border-rose-500/20 hover:text-rose-300'}`}
                            >
                              Retiro
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Monto (USD)</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">$</span>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={capitalModal.amount}
                              onChange={e => setCapitalModal(prev => ({ ...prev, amount: e.target.value }))}
                              placeholder="0.00"
                              className="w-full h-10 pl-7 pr-3 bg-slate-950/40 border border-slate-700 rounded-xl text-sm text-white font-semibold placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Concepto / nota</label>
                          <textarea
                            value={capitalModal.notes}
                            onChange={e => setCapitalModal(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Ej: Aporte mensual de operaciones, retiro de utilidades..."
                            className="w-full px-3 py-2 bg-slate-950/40 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 h-20 resize-y"
                          />
                        </div>

                        {capitalModal.type === 'RETIRO_CAPITAL' && (
                          <p className="text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                            El retiro se descuenta del capital disponible. Máximo retirable: <strong>{fmtUsd(capitalSummary.netCapital)}</strong>.
                          </p>
                        )}

                        <div className="flex gap-3 pt-1">
                          <button
                            onClick={() => setCapitalModal(prev => ({ ...prev, open: false }))}
                            className={`flex-1 py-2.5 rounded-xl font-semibold text-xs transition-all ${themeDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleCapitalMovementSave()}
                            disabled={capitalModal.loading}
                            className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all disabled:opacity-60 ${capitalModal.type === 'APORTE_CAPITAL' ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950' : 'bg-rose-500 hover:bg-rose-600 text-white'}`}
                          >
                            {capitalModal.loading ? 'Guardando...' : capitalModal.type === 'APORTE_CAPITAL' ? 'Registrar aporte' : 'Registrar retiro'}
                          </button>
                        </div>
                      </div>
                    )}

                    {capitalModal.tab === 'historial' && (
                      <div className="rounded-xl border border-slate-800/80 overflow-hidden">
                        <div className="px-3 py-2 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-200">Historial cronológico de capital</span>
                          <span className="text-[10px] text-slate-500">{capitalMovements.length} movimiento(s)</span>
                        </div>
                        <div className="max-h-[46vh] overflow-y-auto overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-800/30 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0">
                              <tr>
                                <th className="text-left py-2 px-3">Fecha</th>
                                <th className="text-left py-2 px-3">Mes</th>
                                <th className="text-left py-2 px-3">Tipo</th>
                                <th className="text-right py-2 px-3">Monto USD</th>
                                <th className="text-left py-2 px-3">Moneda</th>
                                <th className="text-left py-2 px-3">Concepto</th>
                                <th className="text-right py-2 px-3"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {capitalMovements.length === 0 ? (
                                <tr><td colSpan="7" className="py-5 px-3 text-center text-slate-500">Sin movimientos registrados.</td></tr>
                              ) : capitalMovements.map((m) => (
                                <tr key={m.id} className="border-t border-slate-800/70 hover:bg-slate-800/20">
                                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{new Date(m.createdAt || 0).toLocaleDateString('es-VE')}</td>
                                  <td className="py-2 px-3 text-slate-400 whitespace-nowrap">{monthNameFor(m.createdAt)}</td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${m.type === 'APORTE_CAPITAL' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border-rose-500/20'}`}>
                                      {m.type === 'APORTE_CAPITAL' ? 'Aporte' : 'Retiro'}
                                    </span>
                                  </td>
                                  <td className={`py-2 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${m.type === 'APORTE_CAPITAL' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {m.type === 'APORTE_CAPITAL' ? '+' : '−'}{fmtUsd(m.amountUsd)}
                                  </td>
                                  <td className="py-2 px-3 text-slate-400">{m.currencyOrigin || 'USD'}</td>
                                  <td className="py-2 px-3 text-slate-400 max-w-[15rem] truncate" title={m.notes || ''}>{m.notes || '—'}</td>
                                  <td className="py-2 px-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCapitalMovement(m.id)}
                                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                                      title="Eliminar movimiento"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Bloque: Cobros urgentes y accesos rápidos */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className={`${card} p-5 h-full`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-400" />
                      Cobros urgentes y vencimientos
                    </h3>
                    <button onClick={() => setActiveTab('loans')} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">
                      Ver todos ({loans.length}) →
                    </button>
                  </div>

                  {urgentCount === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                      <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-70" />
                      <p className="text-sm font-medium">Toda la cartera está al día.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {loans
                        .filter(l => l.status === 'moroso' || l.status === 'proximo')
                        .slice(0, 4)
                        .map(loan => (
                          <div key={loan.id} className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition-all">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${loan.status === 'moroso' ? 'bg-rose-500 animate-pulse' : 'bg-amber-400'}`} />
                              <div className="min-w-0">
                                <h5 className="font-semibold text-sm text-white truncate">{loan.clientName}</h5>
                                <p className="text-[11px] text-slate-400 truncate">{loan.productName} • Cuota: {fmtUsd(loan.installmentAmount)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${loan.status === 'moroso' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                                {loan.status === 'moroso' ? 'Atrasado' : 'Próximo'}
                              </span>
                              <button
                                onClick={() => {
                                  if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                                  const firstUnpaid = (loan.installments || []).find(i => !i.paid);
                                  setQuickPaySelection(firstUnpaid ? String(firstUnpaid.number) : 'all');
                                  setQuickPayModal({ open: true, loan });
                                }}
                                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs"
                              >
                                Cobrar
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Accesos rápidos */}
              <div className={`${card} p-5 h-fit`}>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Accesos rápidos
                </h3>
                <div className="space-y-2.5">
                  <button
                    onClick={() => {
                      if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                      setLoanModal({
                        open: true,
                        data: { clientId: '', type: 'producto', productId: '', principal: '', downPayment: 0, interestRate: 15, interestRateUnlocked: false, installmentCount: 4, frequency: 'quincenal', startDate: new Date().toISOString().split('T')[0], notes: '' }
                      });
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 font-semibold text-xs transition-all"
                  >
                    <span className="flex items-center gap-2"><Plus className="w-4 h-4" />Nuevo financiamiento</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; } setClientModal({ open: true, data: null }); }}
                    className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition-all"
                  >
                    <span className="flex items-center gap-2"><User className="w-4 h-4" />Registrar cliente</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; } setProductModal({ open: true, data: null }); }}
                    className="w-full flex items-center justify-between p-3 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 font-semibold text-xs transition-all"
                  >
                    <span className="flex items-center gap-2"><Smartphone className="w-4 h-4" />Crear producto</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setActiveTab('ecommerce')}
                    className="w-full flex items-center justify-between p-3 rounded-2xl bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 text-teal-300 font-semibold text-xs transition-all"
                  >
                    <span className="flex items-center gap-2"><Upload className="w-4 h-4" />Subir comprobante (OCR)</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setActiveTab('loans')}
                    className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition-all"
                  >
                    <span className="flex items-center gap-2"><Wallet className="w-4 h-4" />Registrar abono / cuota</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>
          </div>
          );
        })()}

        {/* ============================================================== */}
        {/* TAB 2: FINANCIAMIENTOS Y DEUDAS (MÓDULO CONSOLIDADO)           */}
        {/* ============================================================== */}
        {activeTab === 'loans' && (() => {
          const statusMeta = {
            al_dia: {
              label: 'Al día',
              short: 'Al día',
              dot: 'bg-emerald-400 shadow-lg shadow-emerald-400/50',
              chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
            },
            proximo: {
              label: 'Próximo a vencer',
              short: 'Próximo',
              dot: 'bg-amber-400 shadow-lg shadow-amber-400/50',
              chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            },
            moroso: {
              label: 'Moroso / Atrasado',
              short: 'Moroso',
              dot: 'bg-rose-500 shadow-lg shadow-rose-500/50',
              chip: 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }
          };

          // Cartera activa: excluye contratos completados (van al Historial) y
          // financiamientos dados de baja (archivados / Lista Negra).
          const activePortfolioLoans = (loans || []).filter(loan =>
            !loan.archived && loan.status !== 'completado' && loan.status !== 'archivado'
          );

          const statusOrder = ['al_dia', 'proximo', 'moroso'];

          const statusCounts = statusOrder.reduce((acc, st) => {
            acc[st] = activePortfolioLoans.filter(l => l.status === st).length;
            return acc;
          }, {});

          const clientsByStatus = statusOrder.reduce((acc, st) => {
            acc[st] = new Set(activePortfolioLoans.filter(l => l.status === st).map(l => l.clientId)).size;
            return acc;
          }, {});

          const searchTerm = loanSearch.trim().toLowerCase();
          const searchedLoans = activePortfolioLoans.filter(loan => {
            if (!searchTerm) return true;
            return (loan.clientName || '').toLowerCase().includes(searchTerm)
              || (loan.productName || '').toLowerCase().includes(searchTerm)
              || (loan.type || '').toLowerCase().includes(searchTerm);
          });

          const filteredLoans = searchedLoans.filter(
            l => debtorStatusFilter === 'todos' || l.status === debtorStatusFilter
          );

          const sortedLoans = [...filteredLoans].sort((a, b) => {
            const dir = loanSort.dir === 'asc' ? 1 : -1;
            let av;
            let bv;
            switch (loanSort.field) {
              case 'financedAmount':
                av = Number(a.financedAmount) || 0;
                bv = Number(b.financedAmount) || 0;
                break;
              case 'totalAmount':
                av = Number(a.totalAmount) || 0;
                bv = Number(b.totalAmount) || 0;
                break;
              case 'pendingAmount':
                av = Number(a.stats?.pendingAmount) || 0;
                bv = Number(b.stats?.pendingAmount) || 0;
                break;
              case 'progressPercent':
                av = Number(a.stats?.progressPercent) || 0;
                bv = Number(b.stats?.progressPercent) || 0;
                break;
              case 'status':
                av = statusOrder.indexOf(a.status);
                bv = statusOrder.indexOf(b.status);
                break;
              case 'productName':
                av = (a.productName || '').toLowerCase();
                bv = (b.productName || '').toLowerCase();
                break;
              case 'clientName':
              default:
                av = (a.clientName || '').toLowerCase();
                bv = (b.clientName || '').toLowerCase();
                break;
            }
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
          });

          const totalReceivable = activePortfolioLoans.reduce(
            (sum, l) => sum + (Number(l.stats?.pendingAmount) || 0),
            0
          );
          const pendingProfit = activePortfolioLoans.reduce((sum, loan) => {
            const total = Number(loan.totalAmount) || 0;
            const pending = Number(loan.stats?.pendingAmount) || 0;
            const projected = Number(loan.stats?.projectedProfit) || 0;
            if (total <= 0 || pending <= 0) return sum;
            return sum + projected * (pending / total);
          }, 0);
          const morosoPending = activePortfolioLoans
            .filter(l => l.status === 'moroso')
            .reduce((sum, l) => sum + (Number(l.stats?.pendingAmount) || 0), 0);
          const uniqueClients = new Set(activePortfolioLoans.map(l => l.clientId)).size;

          // Estadísticas temporales basadas en pagos registrados (historial)
          const paymentDateStr = (p) => (p?.date || p?.createdAt || '').slice(0, 10);
          const inStatsPeriod = (dateStr) => {
            if (!dateStr) return false;
            const f = loanStatsFilter || {};
            if (f.mode === 'day') return f.day ? dateStr === f.day : true;
            if (f.mode === 'month') return f.month ? dateStr.startsWith(f.month) : true;
            if (f.mode === 'year') return f.year ? dateStr.startsWith(String(f.year)) : true;
            if (f.mode === 'range') {
              const from = f.from || '0000-01-01';
              const to = f.to || '9999-12-31';
              return dateStr >= from && dateStr <= to;
            }
            return true;
          };

          const loansById = (loans || []).reduce((acc, l) => {
            acc[l.id] = l;
            return acc;
          }, {});

          const filteredPayments = (payments || []).filter(p => inStatsPeriod(paymentDateStr(p)));
          const fallbackBcv = Number(dolarRates?.oficial) || 0;
          const statsPaidUsd = filteredPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
          const statsPaidBs = filteredPayments.reduce((sum, p) => {
            const usd = Number(p.amount) || 0;
            const rate = Number(p.bcvRate) || fallbackBcv;
            const bs = p.amountBs != null ? Number(p.amountBs) : (rate > 0 ? usd * rate : 0);
            return sum + (Number.isFinite(bs) ? bs : 0);
          }, 0);
          const statsNetProfit = filteredPayments.reduce((sum, p) => {
            const loan = loansById[p.loanId];
            if (!loan) return sum;
            const total = Number(loan.totalAmount) || 0;
            const projected = Number(loan.stats?.projectedProfit) || 0;
            if (total <= 0 || projected <= 0) return sum;
            const usd = Number(p.amount) || 0;
            return sum + usd * (projected / total);
          }, 0);

          const sortIcon = (field) => (
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-all ${
                loanSort.field === field ? 'opacity-100 text-emerald-400' : 'opacity-40'
              } ${loanSort.field === field && loanSort.dir === 'asc' ? 'rotate-180' : ''}`}
            />
          );

          const toggleSort = (field) => {
            setLoanSort(prev => ({
              field,
              dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc'
            }));
          };

          const headerMain = `block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`;
          const headerSub = `mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`;
          const stickyHead = themeDark ? 'bg-slate-800' : 'bg-slate-100';
          const stickyCell = themeDark
            ? 'bg-slate-900 text-slate-500 group-hover:bg-slate-800'
            : 'bg-white text-slate-400 group-hover:bg-slate-50';

          return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Financiamientos y Deudas</h2>
                <p className="text-slate-400 text-xs">
                  Cartera consolidada de contratos, cronogramas de cuotas y estado de cobranza en tiempo real.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => {
                    setHistorySearch('');
                    setHistoryModal(true);
                  }}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${themeDark
                    ? 'bg-teal-500/10 border-teal-500/30 text-teal-300 hover:bg-teal-500/20'
                    : 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'}`}
                >
                  <History className="w-4 h-4" />
                  <span>Historial</span>
                </button>
                <button
                  onClick={() => {
                    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                    setLoanModal({
                      open: true,
                      data: {
                        clientId: '',
                        type: 'producto',
                        productId: '',
                        principal: '',
                        downPayment: 0,
                        interestRate: 15,
                        interestRateUnlocked: false,
                        installmentCount: 4,
                        frequency: 'quincenal',
                        startDate: new Date().toISOString().split('T')[0],
                        notes: ''
                      }
                    });
                  }}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nuevo Financiamiento</span>
                </button>
              </div>
            </div>

            {/* Filtro temporal para cuadros estadísticos */}
            {(() => {
              const f = loanStatsFilter || {};
              const controlClass = `px-2.5 py-1.5 rounded-lg border text-[11px] ${themeDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`;
              return (
                <div className={`flex flex-wrap items-center gap-2 p-3 rounded-2xl border ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Período</span>
                  <select
                    value={f.mode || 'month'}
                    onChange={(e) => setLoanStatsFilter(prev => ({ ...prev, mode: e.target.value }))}
                    className={controlClass}
                  >
                    <option value="day">Día</option>
                    <option value="month">Mes</option>
                    <option value="year">Año</option>
                    <option value="range">Rango personalizado</option>
                  </select>
                  {f.mode === 'day' && (
                    <input type="date" value={f.day || ''} onChange={(e) => setLoanStatsFilter(prev => ({ ...prev, day: e.target.value }))} className={controlClass} />
                  )}
                  {f.mode === 'month' && (
                    <input type="month" value={f.month || ''} onChange={(e) => setLoanStatsFilter(prev => ({ ...prev, month: e.target.value }))} className={controlClass} />
                  )}
                  {f.mode === 'year' && (
                    <input type="number" min="2000" max="2100" step="1" value={f.year || ''} onChange={(e) => setLoanStatsFilter(prev => ({ ...prev, year: e.target.value }))} className={`${controlClass} w-24`} placeholder="Año" />
                  )}
                  {f.mode === 'range' && (
                    <>
                      <input type="date" value={f.from || ''} onChange={(e) => setLoanStatsFilter(prev => ({ ...prev, from: e.target.value }))} className={controlClass} />
                      <span className="text-[10px] text-slate-500">hasta</span>
                      <input type="date" value={f.to || ''} onChange={(e) => setLoanStatsFilter(prev => ({ ...prev, to: e.target.value }))} className={controlClass} />
                    </>
                  )}
                  <span className="text-[10px] text-slate-500">Aplica a pagos registrados y ganancias netas acumuladas</span>
                </div>
              );
            })()}

            {/* KPIs superiores de la cartera consolidada */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total pagado (financiamientos)</p>
                  <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                    <DollarSign className="w-4 h-4" />
                  </span>
                </div>
                <p className={`mt-2 text-lg font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                  Bs {(statsPaidBs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-emerald-400">${(statsPaidUsd || 0).toFixed(2)} USD</p>
                <p className="mt-1 text-[10px] text-slate-500">Bs calculados con tasa BCV del día de cada pago (o tasa actual si no registrada)</p>
              </div>

              <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Ganancias netas acumuladas</p>
                  <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                  </span>
                </div>
                <p className="mt-2 text-xl font-bold leading-none tabular-nums text-emerald-400">
                  ${(statsNetProfit || 0).toFixed(2)}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">Ganancia realizada por los pagos del período</p>
              </div>

              <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total por cobrar</p>
                  <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    <Wallet className="w-4 h-4" />
                  </span>
                </div>
                <p className={`mt-2 text-xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                  ${totalReceivable.toFixed(2)}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">Saldo pendiente de la cartera activa</p>
              </div>

              <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-rose-950/20 border-rose-500/30' : 'bg-rose-50 border-rose-200'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">Pendiente de morosos</p>
                  <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
                    <AlertTriangle className="w-4 h-4" />
                  </span>
                </div>
                <p className="mt-2 text-xl font-bold leading-none tabular-nums text-rose-400">
                  ${morosoPending.toFixed(2)}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">{morosoLoans.length} financiamiento(s) en mora</p>
              </div>
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="relative w-full xl:w-72">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={loanSearch}
                  onChange={(e) => setLoanSearch(e.target.value)}
                  placeholder="Buscar por cliente, concepto o tipo..."
                  className={`w-full pl-9 pr-8 py-2 border rounded-xl text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${themeDark ? 'bg-slate-800/60 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                />
                {loanSearch ? (
                  <button
                    type="button"
                    onClick={() => setLoanSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white"
                    title="Limpiar búsqueda"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              <div className={`flex items-center gap-1 p-1 rounded-2xl border overflow-x-auto no-scrollbar ${themeDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
                {['todos', ...statusOrder].map(st => {
                  const active = debtorStatusFilter === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setDebtorStatusFilter(st)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-all ${
                        active
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : themeDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {st !== 'todos' && statusMeta[st]?.dot ? (
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${statusMeta[st].dot}`}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>{st === 'todos' ? 'Todos' : (statusMeta[st]?.short || st)}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] tabular-nums ${
                        active ? 'bg-slate-950/20 text-slate-950' : themeDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {st === 'todos' ? activePortfolioLoans.length : (statusCounts[st] || 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className={`rounded-3xl border overflow-hidden ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-left text-xs">
                    <thead className={`border-b-2 ${themeDark ? 'border-slate-700 bg-slate-800' : 'border-slate-300 bg-slate-100'}`}>
                      <tr className="align-middle whitespace-nowrap">
                        <th className={`sticky left-0 z-20 w-12 py-3 px-2 text-center align-middle ${stickyHead}`}>
                          <span className={headerMain}>#</span>
                          <span className={headerSub}>Ítem</span>
                        </th>
                        <th className="py-3 px-3 text-left align-middle">
                          <button type="button" onClick={() => toggleSort('clientName')} className="inline-flex items-center gap-1.5 text-left" title="Ordenar por cliente (A-Z)">
                            <span className="flex flex-col">
                              <span className={headerMain}>Cliente</span>
                              <span className={headerSub}>Nombre / Inicio</span>
                            </span>
                            {sortIcon('clientName')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-left align-middle">
                          <button type="button" onClick={() => toggleSort('productName')} className="inline-flex items-center gap-1.5 text-left" title="Ordenar por concepto (A-Z)">
                            <span className="flex flex-col">
                              <span className={headerMain}>Concepto</span>
                              <span className={headerSub}>Tipo / Producto</span>
                            </span>
                            {sortIcon('productName')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <button type="button" onClick={() => toggleSort('financedAmount')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por monto financiado">
                            <span className="flex flex-col items-center">
                              <span className={headerMain}>Financiado</span>
                              <span className={headerSub}>Monto base</span>
                            </span>
                            {sortIcon('financedAmount')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <button type="button" onClick={() => toggleSort('totalAmount')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por total con interés">
                            <span className="flex flex-col items-center">
                              <span className={headerMain}>Total c/Interés</span>
                              <span className={headerSub}>A pagar</span>
                            </span>
                            {sortIcon('totalAmount')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <button type="button" onClick={() => toggleSort('progressPercent')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por progreso de cuotas">
                            <span className="flex flex-col items-center">
                              <span className={headerMain}>Cuotas</span>
                              <span className={headerSub}>Progreso</span>
                            </span>
                            {sortIcon('progressPercent')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <button type="button" onClick={() => toggleSort('pendingAmount')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por saldo pendiente">
                            <span className="flex flex-col items-center">
                              <span className={headerMain}>Saldo Pendiente</span>
                              <span className={headerSub}>Por cobrar</span>
                            </span>
                            {sortIcon('pendingAmount')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <button type="button" onClick={() => toggleSort('status')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por estado">
                            <span className="flex flex-col items-center">
                              <span className={headerMain}>Estado</span>
                              <span className={headerSub}>Semáforo</span>
                            </span>
                            {sortIcon('status')}
                          </button>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <span className={headerMain}>Acciones</span>
                          <span className={headerSub}>Gestión</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {sortedLoans.map((loan, index) => {
                        const isExpanded = expandedLoanId === loan.id;
                        const meta = statusMeta[loan.status] || statusMeta.al_dia;
                        const paidCount = loan.stats?.paidCount || 0;
                        const totalCount = loan.stats?.totalInstallments || loan.installmentCount || 1;
                        const progressPct = loan.stats?.progressPercent || 0;
                        const pendingAmount = Number(loan.stats?.pendingAmount) || 0;

                        return (
                          <React.Fragment key={loan.id}>
                            <tr className="group hover:bg-slate-800/30 transition-colors">
                              <td className={`sticky left-0 z-10 w-12 py-2.5 px-2 text-center align-middle text-[11px] font-semibold tabular-nums ${stickyCell}`}>
                                {index + 1}
                              </td>
                              <td className="py-2.5 px-3 align-middle">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} title={meta.label} />
                                  <div className="min-w-0">
                                    <div className="font-bold text-white text-sm leading-tight truncate">{loan.clientName}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-500">Inicio: {loan.startDate}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 align-middle">
                                <span className={`px-2 py-0.5 rounded-md font-semibold text-[9px] uppercase ${loan.type === 'producto' ? 'bg-purple-500/10 text-purple-300' : 'bg-teal-500/10 text-teal-300'}`}>
                                  {loan.type}
                                </span>
                                <div className="mt-0.5 max-w-[170px] truncate text-[11px] font-medium text-slate-300" title={loan.productName}>
                                  {loan.productName}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center whitespace-nowrap align-middle">
                                <span className="font-semibold text-slate-200 tabular-nums">${(Number(loan.financedAmount) || 0).toFixed(2)}</span>
                              </td>
                              <td className="py-2.5 px-3 text-center whitespace-nowrap align-middle">
                                <span className="font-bold text-emerald-400 tabular-nums">${(Number(loan.totalAmount) || 0).toFixed(2)}</span>
                                <div className="text-[9px] text-slate-500">{loan.interestRate}% recargo</div>
                              </td>
                              <td className="py-2.5 px-3 align-middle">
                                <div className="mx-auto w-32">
                                  <div className="flex items-center justify-between text-[10px] font-semibold mb-1">
                                    <span className="text-slate-400 tabular-nums">{paidCount}/{totalCount}</span>
                                    <span className={loan.status === 'moroso' ? 'text-rose-400' : 'text-emerald-400'}>{progressPct}%</span>
                                  </div>
                                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${loan.status === 'moroso' ? 'bg-gradient-to-r from-rose-500 to-amber-500' : 'bg-gradient-to-r from-emerald-500 to-teal-400'}`}
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </div>
                                  <div className="mt-0.5 text-[9px] text-slate-500">${(Number(loan.installmentAmount) || 0).toFixed(2)} / {loan.frequency}</div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center whitespace-nowrap align-middle">
                                <span className={`font-bold tabular-nums ${pendingAmount > 0 ? (loan.status === 'moroso' ? 'text-rose-400' : 'text-amber-400') : 'text-slate-400'}`}>
                                  ${pendingAmount.toFixed(2)}
                                </span>
                                <div className="text-[9px] text-slate-500">
                                  {pendingAmount > 0 ? `${loan.stats?.pendingCount || 0} cuota(s)` : 'Cancelado'}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center align-middle">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${meta.chip}`}>
                                  {meta.short}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center align-middle">
                                <div className="inline-flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                                      const firstUnpaid = (loan.installments || []).find(i => !i.paid);
                                      setQuickPaySelection(firstUnpaid ? String(firstUnpaid.number) : 'all');
                                      setQuickPayModal({ open: true, loan });
                                    }}
                                    title="Registrar abono o pago de cuota"
                                    aria-label="Registrar abono o pago de cuota"
                                    className="p-2 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors"
                                  >
                                    <Wallet className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedLoanId(isExpanded ? null : loan.id)}
                                    title={isExpanded ? 'Ocultar cronograma' : 'Ver cronograma de cuotas'}
                                    aria-label={isExpanded ? 'Ocultar cronograma' : 'Ver cronograma de cuotas'}
                                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                                  >
                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                                      setDeleteLoanModal({ open: true, loan, processing: false });
                                    }}
                                    title="Dar de baja por incumplimiento"
                                    aria-label="Dar de baja por incumplimiento"
                                    className="p-2 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-slate-800 transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr>
                                <td colSpan={9} className={`px-4 py-4 ${themeDark ? 'bg-slate-950/40' : 'bg-slate-50'}`}>
                                  <div className="flex items-center justify-between gap-3 mb-3">
                                    <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                      Cronograma Detallado de Cuotas
                                    </h5>
                                    <span className="text-[10px] text-slate-500">
                                      {paidCount} de {totalCount} cuotas canceladas • Saldo ${pendingAmount.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
                                    {(loan.installments || []).map(inst => (
                                      <div
                                        key={inst.number}
                                        className={`p-3 rounded-2xl border text-xs flex flex-col justify-between ${inst.paid
                                          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                                          : new Date(inst.dueDate) < new Date()
                                            ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                                            : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                                          }`}
                                      >
                                        <div className="flex items-center justify-between mb-1.5">
                                          <span className="font-bold">Cuota #{inst.number}</span>
                                          {inst.paid
                                            ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                            : <Clock className="w-3.5 h-3.5 text-slate-400" />}
                                        </div>
                                        <div className="font-extrabold text-sm">${inst.amount}</div>
                                        <div className="text-[11px] text-slate-400 mt-1">Vence: {inst.dueDate}</div>
                                        {inst.paid && (
                                          <div className="text-[10px] text-emerald-400 mt-1 truncate">
                                            Ref: {inst.receiptRef || 'Pagado'}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {sortedLoans.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-10 px-4 text-center">
                            <div className={`text-xs font-semibold ${themeDark ? 'text-slate-300' : 'text-slate-700'}`}>
                              {searchTerm || debtorStatusFilter !== 'todos'
                                ? 'No hay financiamientos que coincidan con la búsqueda o el filtro.'
                                : 'No hay financiamientos registrados todavía.'}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-500">
                              Crea un nuevo financiamiento para comenzar a construir la cartera de cobranza.
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
          );
        })()}

        {/* ============================================================== */}
        {/* TAB 4: GESTIÓN DE CLIENTES & RÉCORD CREDITICIO                */}
        {/* ============================================================== */}
        {activeTab === 'clients' && (() => {
          const trustConfig = getTrustLevelConfig(settings);

          const loansByClient = (loans || []).reduce((acc, loan) => {
            if (!loan?.clientId) return acc;
            if (!acc[loan.clientId]) acc[loan.clientId] = [];
            acc[loan.clientId].push(loan);
            return acc;
          }, {});

          // El nivel se recalcula en caliente con la configuración global vigente.
          const getClientTrust = (client) =>
            computeClientTrust(loansByClient[client.id] || [], trustConfig);

          const formatClientDate = (value) => {
            if (!value) return 'Sin fecha';
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-VE');
          };

          const searchTerm = clientSearch.trim().toLowerCase();
          const filteredClients = (clients || []).filter(client => {
            if (!searchTerm) return true;
            return (client.name || '').toLowerCase().includes(searchTerm)
              || (client.dni || '').toLowerCase().includes(searchTerm)
              || (client.phone || '').toLowerCase().includes(searchTerm);
          });

          const trustCounts = (clients || []).reduce((acc, client) => {
            const trust = getClientTrust(client);
            acc[trust.level] = (acc[trust.level] || 0) + 1;
            return acc;
          }, { alto: 0, medio: 0, riesgoso: 0 });

          const trustBadgeStyles = {
            alto: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            medio: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
            riesgoso: 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          };

          const trustIcons = {
            alto: CheckCircle,
            medio: Clock,
            riesgoso: AlertTriangle
          };

          return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Clientes</h2>
                <p className="text-slate-400 text-xs">
                  Datos de contacto, historial crediticio y nivel de confianza calculado automáticamente según el comportamiento de pago.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Buscar por nombre, cédula o teléfono..."
                    className={`w-full sm:w-64 pl-9 pr-8 py-2 border rounded-xl text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${themeDark ? 'bg-slate-800/60 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                  />
                  {clientSearch ? (
                    <button
                      type="button"
                      onClick={() => setClientSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={() => {
                    setBlacklistSearch('');
                    setBlacklistModal(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  title="Ver clientes restringidos y reincorporarlos"
                >
                  <Ban className="w-4 h-4" />
                  <span>Lista Negra</span>
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] tabular-nums bg-rose-500/20 text-rose-200">
                    {blacklist.length}
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                    setClientModal({ open: true, data: null });
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Registrar Cliente</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-6 items-start">
              <div className={`rounded-3xl border overflow-hidden ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-xs">
                    <thead className={`border-b-2 ${themeDark ? 'border-slate-700 bg-slate-800' : 'border-slate-300 bg-slate-100'}`}>
                      <tr className="align-middle whitespace-nowrap">
                        <th className={`sticky left-0 z-20 w-12 py-3 px-2 text-center align-middle ${themeDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>#</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Ítem</span>
                        </th>
                        <th className="py-3 px-3 text-left align-middle">
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Cliente</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Nombre / Identificación</span>
                        </th>
                        <th className="py-3 px-3 text-left align-middle">
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Contacto</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Teléfono / Dirección</span>
                        </th>
                        <th className="py-3 px-3 text-left align-middle">
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Registro</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Alta / Notas</span>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Finanzas</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Crédito / Deuda</span>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Confianza</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Nivel automático</span>
                        </th>
                        <th className="py-3 px-3 text-center align-middle">
                          <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Acciones</span>
                          <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Gestión</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filteredClients.map((client, index) => {
                        const trust = getClientTrust(client);
                        const TrustIcon = trustIcons[trust.level] || Clock;
                        return (
                          <tr key={client.id} className="group hover:bg-slate-800/30 transition-colors">
                            <td className={`sticky left-0 z-10 w-12 py-2.5 px-2 text-center align-middle text-[11px] font-semibold tabular-nums ${themeDark ? 'bg-slate-900 text-slate-500 group-hover:bg-slate-800' : 'bg-white text-slate-400 group-hover:bg-slate-50'}`}>
                              {index + 1}
                            </td>
                            <td className="py-2.5 px-3 align-middle">
                              <div className="font-bold text-white text-sm leading-tight">{client.name}</div>
                              <div className="mt-0.5 text-[11px] font-semibold text-emerald-400">{client.dni}</div>
                            </td>
                            <td className="py-2.5 px-3 align-middle">
                              <div className="flex items-center gap-1.5 text-slate-300">
                                <Phone className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>{client.phone || 'No registrado'}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span className="max-w-[180px] truncate" title={client.address || ''}>
                                  {client.address || 'Sin dirección registrada'}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 align-middle">
                              <div className="text-slate-300">{formatClientDate(client.createdAt)}</div>
                              <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-slate-500" title={client.notes || ''}>
                                {client.notes || 'Sin notas'}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center align-middle">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] text-slate-400">
                                  {client.stats?.totalLoansCount || 0} financiamiento(s)
                                </span>
                                <span className={`text-[11px] font-bold tabular-nums ${client.stats?.activeDebt > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                                  ${(Number(client.stats?.activeDebt) || 0).toFixed(2)} deuda
                                </span>
                                <span className={`text-[10px] ${client.stats?.overdueDebt > 0 ? 'text-rose-400 font-semibold' : 'text-slate-500'}`}>
                                  {client.stats?.overdueDebt > 0
                                    ? `$${Number(client.stats.overdueDebt).toFixed(2)} vencido`
                                    : `${client.stats?.paidRatio ?? 100}% cumplimiento`}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center align-middle">
                              <div className="flex flex-col items-center gap-1">
                                <span
                                  title={trust.description}
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${trustBadgeStyles[trust.level] || trustBadgeStyles.medio}`}
                                >
                                  <TrustIcon className="w-3 h-3" />
                                  {trust.label}
                                </span>
                                <span className="max-w-[160px] text-center text-[9px] leading-tight text-slate-500" title={trust.reason}>
                                  {trust.reason}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center align-middle">
                              <div className="inline-flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setViewHistoryClient(client)}
                                  title="Ver récord crediticio"
                                  className="p-2 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                                    setClientModal({ open: true, data: client });
                                  }}
                                  title="Editar cliente"
                                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteClient(client)}
                                  title="Eliminar cliente"
                                  className="p-2 rounded-lg text-rose-400 hover:text-white hover:bg-slate-800 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredClients.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-10 px-4 text-center">
                            <div className={`text-xs font-semibold ${themeDark ? 'text-slate-300' : 'text-slate-700'}`}>
                              {searchTerm ? 'No hay clientes que coincidan con la búsqueda.' : 'No hay clientes registrados todavía.'}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-500">
                              Registra un cliente para comenzar a construir su historial crediticio.
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <PieChart className="w-4 h-4 text-emerald-400" />
                  <h3 className={`text-[11px] font-bold uppercase tracking-wider ${themeDark ? 'text-white' : 'text-slate-800'}`}>Resumen de clientes</h3>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total registrados</p>
                    <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                      <Users className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    {(clients || []).length}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Clientes en el sistema</p>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{trustConfig.levels.alto.label}</p>
                    <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <CheckCircle className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    {trustCounts.alto || 0}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Pagos al día o en cronograma</p>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{trustConfig.levels.medio.label}</p>
                    <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                      <Clock className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    {trustCounts.medio || 0}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Retrasos menores con cuotas canceladas</p>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{trustConfig.levels.riesgoso.label}</p>
                    <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    {trustCounts.riesgoso || 0}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Cuotas vencidas o retrasos mayores</p>
                </div>

                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <p className="text-[10px] leading-relaxed text-emerald-300/90">
                    El nivel de confianza se calcula automáticamente según las fechas de pago y los umbrales globales definidos por el administrador.
                  </p>
                </div>
              </aside>
            </div>
          </div>
          );
        })()}

        {/* ============================================================== */}
        {/* TAB 5: CATÁLOGO DE PRODUCTOS / COSTOS & MARGEN                */}
        {/* ============================================================== */}
        {activeTab === 'products' && (() => {
          // Productos visibles en la tabla principal: solo con stock disponible.
          // Al financiarse una unidad, el stock se decrementa y el producto sale de la vista al agotarse.
          const availableProducts = products.filter(p => (Number(p.stock) || 0) > 0);
          const searchTerm = productSearch.trim().toLowerCase();
          const searchedProducts = searchTerm
            ? availableProducts.filter(p =>
                (p.name || '').toLowerCase().includes(searchTerm) ||
                (p.category || '').toLowerCase().includes(searchTerm)
              )
            : availableProducts;

          const sortedProducts = [...searchedProducts].sort((a, b) => {
            const dir = productSort.dir === 'asc' ? 1 : -1;
            let av;
            let bv;
            switch (productSort.field) {
              case 'costPrice':
                av = Number(a.costPrice) || 0;
                bv = Number(b.costPrice) || 0;
                break;
              case 'salePrice':
                av = a.manualSalePrice ? (Number(a.salePrice) || 0) : getAutoSalePrice(a);
                bv = b.manualSalePrice ? (Number(b.salePrice) || 0) : getAutoSalePrice(b);
                break;
              case 'profitMarginPercent':
                av = getProductMargin(a);
                bv = getProductMargin(b);
                break;
              case 'stock':
                av = Number(a.stock) || 0;
                bv = Number(b.stock) || 0;
                break;
              case 'name':
              default:
                av = (a.name || '').toLowerCase();
                bv = (b.name || '').toLowerCase();
                break;
            }
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
          });

          const stockUnits = availableProducts.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
          const totalInvestment = availableProducts.reduce(
            (sum, p) => sum + (Number(p.costPrice) || 0) * (Number(p.stock) || 0),
            0
          );
          const estimatedProfit = availableProducts.reduce((sum, p) => {
            const cost = Number(p.costPrice) || 0;
            const price = p.manualSalePrice ? (Number(p.salePrice) || 0) : getAutoSalePrice(p);
            return sum + (price - cost) * (Number(p.stock) || 0);
          }, 0);
          const financedCount = (loans || []).filter(l => l.type === 'producto' && l.productId).length;

          const sortIcon = (field) => (
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-all ${
                productSort.field === field ? 'opacity-100 text-emerald-400' : 'opacity-40'
              } ${productSort.field === field && productSort.dir === 'asc' ? 'rotate-180' : ''}`}
            />
          );

          return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Productos</h2>
                <p className="text-slate-400 text-xs">
                  Cálculo automático del margen de ganancia por producto y fijación de precios financiados.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar producto o categoría..."
                    className={`w-full sm:w-64 pl-9 pr-8 py-2 border rounded-xl text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${themeDark ? 'bg-slate-800/60 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                  />
                  {productSearch ? (
                    <button
                      type="button"
                      onClick={() => setProductSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={() => {
                    if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                    setProductModal({ open: true, data: null });
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Registro de producto</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-6 items-start">
              <div className={`rounded-3xl border overflow-hidden ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-xs">
                  <thead className={`border-b-2 ${themeDark ? 'border-slate-700 bg-slate-800' : 'border-slate-300 bg-slate-100'}`}>
                    <tr className="align-middle whitespace-nowrap">
                      <th className={`sticky left-0 z-20 w-12 py-3 px-2 text-center align-middle ${themeDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                        <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>#</span>
                        <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Ítem</span>
                      </th>
                      <th className="py-3 px-3 text-left align-middle">
                        <button type="button" onClick={() => toggleProductSort('name')} className="inline-flex items-center gap-1.5 text-left" title="Ordenar por nombre (A-Z)">
                          <span className="flex flex-col">
                            <span className={`text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Equipo</span>
                            <span className={`mt-0.5 text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Producto / Modelo</span>
                          </span>
                          {sortIcon('name')}
                        </button>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <button type="button" onClick={() => toggleProductSort('costPrice')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por costo">
                          <span className="flex flex-col items-center">
                            <span className={`text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Costo Adq.</span>
                            <span className={`mt-0.5 text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Costo</span>
                          </span>
                          {sortIcon('costPrice')}
                        </button>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <button type="button" onClick={() => toggleProductSort('salePrice')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por precio de venta">
                          <span className="flex flex-col items-center">
                            <span className={`text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Precio Venta Fin.</span>
                            <span className={`mt-0.5 text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>PVP</span>
                          </span>
                          {sortIcon('salePrice')}
                        </button>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <button type="button" onClick={() => toggleProductSort('profitMarginPercent')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por margen">
                          <span className="flex flex-col items-center">
                            <span className={`text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Margen Ganancia</span>
                            <span className={`mt-0.5 text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Margen</span>
                          </span>
                          {sortIcon('profitMarginPercent')}
                        </button>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <button type="button" onClick={() => toggleProductSort('stock')} className="inline-flex items-center justify-center gap-1.5" title="Ordenar por stock">
                          <span className="flex flex-col items-center">
                            <span className={`text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Stock</span>
                            <span className={`mt-0.5 text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Disponibilidad</span>
                          </span>
                          {sortIcon('stock')}
                        </button>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <span className={`block text-xs font-bold leading-tight tracking-wide ${themeDark ? 'text-slate-100' : 'text-slate-800'}`}>Acciones</span>
                        <span className={`mt-0.5 block text-[10px] font-medium leading-tight tracking-wide ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>Gestión</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {sortedProducts.map((prod, index) => (
                      <tr key={prod.id} className="group hover:bg-slate-800/30 transition-colors">
                        <td className={`sticky left-0 z-10 w-12 py-2.5 px-2 text-center align-middle text-[11px] font-semibold tabular-nums ${themeDark ? 'bg-slate-900 text-slate-500 group-hover:bg-slate-800' : 'bg-white text-slate-400 group-hover:bg-slate-50'}`}>
                          {index + 1}
                        </td>
                        <td className="py-2.5 px-3 align-middle">
                          <div className="font-bold text-white text-sm leading-tight">{prod.name}</div>
                          {prod.category ? (
                            <div className="text-[10px] text-slate-500 mt-0.5">{prod.category}</div>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap align-middle">
                          <span className="font-semibold text-slate-200 tabular-nums">
                            ${(Number(prod.costPrice) || 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 align-middle">
                          <div className="flex items-center justify-center gap-2">
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-500">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={prod.manualSalePrice ? (Number(prod.salePrice) || '') : getAutoSalePrice(prod)}
                                readOnly={!prod.manualSalePrice}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const newSalePrice = Number(e.target.value);
                                  if (e.target.value !== '' && !isNaN(newSalePrice) && newSalePrice > 0) {
                                    const cost = Number(prod.costPrice) || 0;
                                    const newMargin = cost > 0 ? Number((((newSalePrice - cost) / cost) * 100).toFixed(1)) : 0;
                                    setProducts(prev => prev.map(p => p.id === prod.id
                                      ? { ...p, salePrice: newSalePrice, profitMarginPercent: newMargin, manualSalePrice: true }
                                      : p));
                                  }
                                }}
                                onBlur={(e) => {
                                  const newSalePrice = Number(e.target.value);
                                  if (e.target.value === '' || isNaN(newSalePrice) || newSalePrice <= 0) return;
                                  const cost = Number(prod.costPrice) || 0;
                                  const newMargin = cost > 0 ? Number((((newSalePrice - cost) / cost) * 100).toFixed(1)) : 0;
                                  persistProduct(prod, { salePrice: newSalePrice, profitMarginPercent: newMargin, manualSalePrice: true });
                                }}
                                className={`w-24 pl-6 pr-2 py-1.5 rounded-lg border text-xs text-right font-bold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                                  prod.manualSalePrice
                                    ? 'bg-slate-800/80 border-emerald-500/40 text-emerald-300'
                                    : 'bg-slate-800/30 border-slate-700 text-slate-300 cursor-not-allowed'
                                }`}
                              />
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!!prod.manualSalePrice}
                              title={prod.manualSalePrice ? 'Cambiar a cálculo automático' : 'Permitir edición manual del precio'}
                              onClick={() => {
                                const nextManual = !prod.manualSalePrice;
                                const cost = Number(prod.costPrice) || 0;
                                const margin = getProductMargin(prod);
                                const nextSale = nextManual
                                  ? (Number(prod.salePrice) || getAutoSalePrice(prod))
                                  : Number((cost * (1 + margin / 100)).toFixed(2));
                                setProducts(prev => prev.map(p => p.id === prod.id
                                  ? { ...p, manualSalePrice: nextManual, salePrice: nextSale }
                                  : p));
                                persistProduct(prod, { manualSalePrice: nextManual, salePrice: nextSale, profitMarginPercent: margin });
                              }}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${prod.manualSalePrice ? 'bg-emerald-500' : 'bg-slate-600'}`}
                            >
                              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${prod.manualSalePrice ? 'translate-x-[1.125rem]' : 'translate-x-1'}`} />
                            </button>
                            <span className={`w-9 text-[9px] font-semibold uppercase tracking-wide ${prod.manualSalePrice ? 'text-emerald-400' : 'text-slate-500'}`}>
                              {prod.manualSalePrice ? 'Manual' : 'Auto'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center align-middle">
                          <div className="inline-flex items-center justify-center gap-1">
                            <div className="relative">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                value={getProductMargin(prod)}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const newMargin = Number(e.target.value);
                                  if (e.target.value !== '' && !isNaN(newMargin) && newMargin >= 0 && newMargin <= 100) {
                                    const nextSale = Number(((Number(prod.costPrice) || 0) * (1 + newMargin / 100)).toFixed(2));
                                    setProducts(prev => prev.map(p => p.id === prod.id
                                      ? { ...p, profitMarginPercent: newMargin, salePrice: nextSale, manualSalePrice: false }
                                      : p));
                                  }
                                }}
                                onBlur={(e) => {
                                  const newMargin = Number(e.target.value);
                                  if (e.target.value === '' || isNaN(newMargin) || newMargin < 0 || newMargin > 100) return;
                                  const nextSale = Number(((Number(prod.costPrice) || 0) * (1 + newMargin / 100)).toFixed(2));
                                  persistProduct(prod, { profitMarginPercent: newMargin, salePrice: nextSale, manualSalePrice: false });
                                }}
                                className="w-16 pl-2 pr-5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-xs font-semibold text-teal-300 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/30 [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-500">%</span>
                            </div>
                            <div className="flex flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-800/70">
                              <button
                                type="button"
                                onClick={() => stepProductMargin(prod, 1)}
                                disabled={getProductMargin(prod) >= 100}
                                title="Subir margen"
                                aria-label="Subir margen"
                                className="flex h-3.5 w-5 items-center justify-center text-slate-400 transition-colors hover:bg-slate-700/70 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => stepProductMargin(prod, -1)}
                                disabled={getProductMargin(prod) <= 0}
                                title="Bajar margen"
                                aria-label="Bajar margen"
                                className="flex h-3.5 w-5 items-center justify-center border-t border-slate-700 text-slate-400 transition-colors hover:bg-slate-700/70 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center align-middle">
                          <span className={`inline-flex items-center justify-center gap-1 min-w-[74px] px-2.5 py-1 rounded-full font-bold text-[10px] tabular-nums ${prod.stock > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                            }`}>
                            {prod.stock} disp.
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center align-middle">
                          <div className="inline-flex items-center justify-center gap-1">
                          <button
                            onClick={() => {
                              if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                              setProductModal({ open: true, data: prod });
                            }}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                              const handleDelete = async () => {
                                const res = await fetch(`/api/products?id=${prod.id}`, {
                                  method: 'DELETE',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'x-user-id': currentUser.id
                                  }
                                });
                                const d = await res.json();
                                if (d.success) {
                                  notify(d.message);
                                  fetchAllData();
                                  setProductModal({ open: false, data: null });
                                } else {
                                  notify(d.error || 'Error al eliminar producto', 'error');
                                }
                              };
                              if (confirm('¿Estás seguro de eliminar este producto?')) {
                                handleDelete();
                              }
                            }}
                            className="p-2 rounded-lg text-red-400 hover:text-white hover:bg-slate-800 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {sortedProducts.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-10 px-4 text-center">
                          <div className={`text-xs font-semibold ${themeDark ? 'text-slate-300' : 'text-slate-700'}`}>
                            {searchTerm ? 'No hay productos que coincidan con la búsqueda.' : 'No hay productos disponibles en stock.'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1">
                            Los productos con stock agotado o ya financiados no se muestran en esta tabla.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <PieChart className="w-4 h-4 text-emerald-400" />
                  <h3 className={`text-[11px] font-bold uppercase tracking-wider ${themeDark ? 'text-white' : 'text-slate-800'}`}>Resumen de inventario</h3>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Productos en stock</p>
                    <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <Smartphone className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    {availableProducts.length}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">{stockUnits} unidades disponibles</p>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Inversión total</p>
                    <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                      <DollarSign className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    ${totalInvestment.toFixed(2)}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Costo total del inventario</p>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Ganancia estimada</p>
                    <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <TrendingUp className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${estimatedProfit > 0 ? 'text-emerald-400' : estimatedProfit < 0 ? 'text-rose-400' : themeDark ? 'text-white' : 'text-slate-900'}`}>
                    ${estimatedProfit.toFixed(2)}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Proyección post-venta del stock</p>
                </div>

                <div className={`rounded-2xl border p-4 ${themeDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Financiados</p>
                    <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                      <CreditCard className="w-4 h-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-bold leading-none tabular-nums ${themeDark ? 'text-white' : 'text-slate-900'}`}>
                    {financedCount}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">Operaciones de financiamiento</p>
                </div>

                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <p className="text-[10px] leading-relaxed text-emerald-300/90">
                    Los productos financiados o con stock agotado se retiran automáticamente de la tabla principal.
                  </p>
                </div>
              </aside>
            </div>
          </div>
          );
        })()}

        {/* ============================================================== */}
        {/* TAB 6: COMERCIO ELECTRÓNICO & OCR IA COMPROBANTES             */}
        {/* ============================================================== */}
        {activeTab === 'ecommerce' && (() => {
          // Filtrado de transacciones para la tabla
          const filteredTxs = (ecommerceData.transactions || []).filter(tx => {
            const matchesType = txTypeFilter === 'todos' ? true : tx.type === txTypeFilter;
            const searchLower = txSearch.toLowerCase().trim();
            if (!searchLower) return matchesType;
            const refMatch = (tx.reference || '').toLowerCase().includes(searchLower);
            const origMatch = (tx.bankOrigin || tx.bank || '').toLowerCase().includes(searchLower);
            const destMatch = (tx.bankDestination || '').toLowerCase().includes(searchLower);
            const dateMatch = (tx.date || '').toLowerCase().includes(searchLower);
            // Búsqueda dual por montos: compara la consulta numérica contra el monto en Bs y en USD
            const digits = searchLower.replace(/\D/g, '');
            const bsStr = String(Number(tx.amountBs) || Number(tx.amount) || 0);
            const usdStr = String(Number(tx.amountUSD) || Number(tx.amount) || 0);
            const amountMatch = digits !== '' && (
              bsStr.replace(/\D/g, '').includes(digits) ||
              usdStr.replace(/\D/g, '').includes(digits)
            );
            return matchesType && (refMatch || origMatch || destMatch || dateMatch || amountMatch);
          });

          // Ordenamiento de columnas
          const sortedTxs = [...filteredTxs].sort((a, b) => {
            let valA, valB;
            if (txSortField === 'date') {
              valA = a.date || '';
              valB = b.date || '';
            } else if (txSortField === 'amountBs') {
              valA = Number(a.amountBs) || 0;
              valB = Number(b.amountBs) || 0;
            } else if (txSortField === 'amountUSD') {
              valA = Number(a.amountUSD) || Number(a.amount) || 0;
              valB = Number(b.amountUSD) || Number(b.amount) || 0;
            } else if (txSortField === 'reference') {
              valA = (a.reference || '').toLowerCase();
              valB = (b.reference || '').toLowerCase();
            } else if (txSortField === 'bankOrigin') {
              valA = (a.bankOrigin || a.bank || '').toLowerCase();
              valB = (b.bankOrigin || b.bank || '').toLowerCase();
            } else {
              // 'createdAt' o cronológico por defecto
              valA = a.createdAt || a.id || '';
              valB = b.createdAt || b.id || '';
            }
            if (valA < valB) return txSortDir === 'asc' ? -1 : 1;
            if (valA > valB) return txSortDir === 'asc' ? 1 : -1;
            return 0;
          });

          const toggleSort = (field) => {
            if (txSortField === field) {
              setTxSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
            } else {
              setTxSortField(field);
              setTxSortDir('asc');
            }
          };

          // Módulo de Cálculos (Filtros: Día, Mes, Año)
          const calcTransactions = (ecommerceData.transactions || []).filter(tx => {
            const txDate = tx.date || (tx.createdAt ? tx.createdAt.slice(0, 10) : '');
            if (!txDate) return false;
            if (calcPeriod === 'day') {
              return txDate === calcDate;
            } else if (calcPeriod === 'month') {
              // calcDate: YYYY-MM
              return txDate.startsWith(calcDate);
            } else if (calcPeriod === 'year') {
              // calcDate: YYYY
              return txDate.startsWith(calcDate);
            }
            return true;
          });

          const calcComprasBs = calcTransactions
            .filter(t => t.type === 'compra')
            .reduce((sum, t) => sum + (Number(t.amountBs) || 0), 0);
          const calcVentasBs = calcTransactions
            .filter(t => t.type === 'venta')
            .reduce((sum, t) => sum + (Number(t.amountBs) || 0), 0);
          // GANANCIA NETA: solo ingresos operativos menos costos operativos.
          // El capital asignado es patrimonio y no se descuenta de la utilidad.
          const calcGananciasBs = calcVentasBs - calcComprasBs;

          const calcComprasUSD = calcTransactions
            .filter(t => t.type === 'compra')
            .reduce((sum, t) => sum + (Number(t.amountUSD) || Number(t.amount) || 0), 0);
          const calcVentasUSD = calcTransactions
            .filter(t => t.type === 'venta')
            .reduce((sum, t) => sum + (Number(t.amountUSD) || Number(t.amount) || 0), 0);
          const calcGananciasUSD = calcVentasUSD - calcComprasUSD;

          return (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Comercio Electrónico & OCR IA</h2>
                  <p className="text-slate-400 text-xs">
                    Conversión automática de comprobantes Bs a USD con tasa BCV oficial y registro de bancos emisor y receptor.
                  </p>
                </div>
                {dolarRates?.oficial && (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 rounded-2xl text-xs">
                    <span className="text-emerald-400 font-bold">Tasa BCV Activa:</span>
                    <span className="text-white font-mono font-extrabold">{dolarRates.oficial.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} Bs/USD</span>
                  </div>
                )}
              </div>

              {/* Módulo de Cálculos Financieros (Día, Mes, Año) */}
              <div className={`p-6 rounded-3xl border ${themeDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <PieChart className="w-5 h-5 text-emerald-400" />
                      Módulo de Cálculos & Resumen Financiero
                    </h3>
                    <p className="text-xs text-slate-400">
                      Totales y balance expresados en Bolívares (Bs) y Dólares (USD). La Ganancia Neta se calcula como Ventas − Compras (sin descontar capital, que es patrimonio).
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Botones de filtro: Día, Mes, Año */}
                    <div className="flex bg-slate-800 p-1 rounded-2xl border border-slate-700">
                      <button
                        type="button"
                        onClick={() => {
                          setCalcPeriod('day');
                          setCalcDate(new Date().toISOString().split('T')[0]);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${calcPeriod === 'day' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                          }`}
                      >
                        Día
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCalcPeriod('month');
                          setCalcDate(new Date().toISOString().slice(0, 7));
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${calcPeriod === 'month' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                          }`}
                      >
                        Mes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCalcPeriod('year');
                          setCalcDate(new Date().getFullYear().toString());
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${calcPeriod === 'year' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                          }`}
                      >
                        Año
                      </button>
                    </div>

                    {/* Selector de Fecha dinámica según el período */}
                    {calcPeriod === 'day' && (
                      <input
                        type="date"
                        value={calcDate}
                        onChange={(e) => setCalcDate(e.target.value)}
                        className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                      />
                    )}
                    {calcPeriod === 'month' && (
                      <input
                        type="month"
                        value={calcDate}
                        onChange={(e) => setCalcDate(e.target.value)}
                        className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                      />
                    )}
                    {calcPeriod === 'year' && (
                      <input
                        type="number"
                        min="2020"
                        max="2035"
                        value={calcDate}
                        onChange={(e) => setCalcDate(e.target.value)}
                        className="w-24 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                      />
                    )}
                  </div>
                </div>

                {/* Tarjetas de Resumen en Bs y USD */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Compras */}
                  <div className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/60">
                    <div className="flex items-center justify-between text-rose-400 font-semibold text-xs uppercase tracking-wider mb-2">
                      <span>Total Compras (Egresos)</span>
                      <ArrowDownRight className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-2xl font-extrabold text-white">
                        {calcComprasBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold text-rose-400">Bs</span>
                      </div>
                      <div className="text-sm font-bold text-slate-400">
                        ${calcComprasUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} <span className="text-xs font-normal text-slate-500">USD</span>
                      </div>
                    </div>
                  </div>

                  {/* Ventas */}
                  <div className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/60">
                    <div className="flex items-center justify-between text-emerald-400 font-semibold text-xs uppercase tracking-wider mb-2">
                      <span>Total Ventas (Ingresos)</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-2xl font-extrabold text-white">
                        {calcVentasBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold text-emerald-400">Bs</span>
                      </div>
                      <div className="text-sm font-bold text-slate-400">
                        ${calcVentasUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} <span className="text-xs font-normal text-slate-500">USD</span>
                      </div>
                    </div>
                  </div>

                  {/* Ganancias */}
                  <div className={`p-5 rounded-2xl border ${calcGananciasBs >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-2">
                      <span className={calcGananciasBs >= 0 ? 'text-emerald-400' : 'text-rose-400'}>Ganancia Neta</span>
                      <TrendingUp className={`w-4 h-4 ${calcGananciasBs >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
                    </div>
                    <div className="space-y-1">
                      <div className={`text-2xl font-extrabold ${calcGananciasBs >= 0 ? 'text-teal-300' : 'text-rose-400'}`}>
                        {calcGananciasBs >= 0 ? '+' : ''}{calcGananciasBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold">Bs</span>
                      </div>
                      <div className={`text-sm font-bold ${calcGananciasUSD >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {calcGananciasUSD >= 0 ? '+' : ''}${calcGananciasUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} <span className="text-xs font-normal text-slate-400">USD</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Escáner OCR & Formulario */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className={`p-6 rounded-3xl border ${themeDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    <h3 className="font-bold text-base text-white">Escáner OCR Inteligente</h3>
                  </div>

                  <form onSubmit={handleProcessOcrAndSave} className="space-y-4">
                    {/* Selector de Tipo: VENTA USDT / COMPRA USDT */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                        Tipo de Operación
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setOcrForm({ ...ocrForm, type: 'venta_usdt' })}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${ocrForm.type === 'venta_usdt'
                              ? 'bg-emerald-500 text-slate-950 shadow-md'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                            }`}
                        >
                          VENTA USDT
                        </button>
                        <button
                          type="button"
                          onClick={() => setOcrForm({ ...ocrForm, type: 'compra_usdt' })}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${ocrForm.type === 'compra_usdt'
                              ? 'bg-rose-500 text-white shadow-md'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                            }`}
                        >
                          COMPRA USDT
                        </button>
                      </div>
                    </div>

                    {/* Subida de Imagen / Comprobante */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                        Adjuntar Capture / Comprobante
                      </label>
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-2xl p-4 text-center cursor-pointer transition-all bg-slate-800/30 hover:bg-slate-800/50"
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        {ocrForm.filePreview ? (
                          <div className="space-y-2">
                            <img
                              src={ocrForm.filePreview}
                              alt="Capture Preview"
                              className="max-h-40 mx-auto rounded-xl object-contain border border-slate-700"
                            />
                            <p className="text-xs text-emerald-400 font-semibold truncate">
                              {ocrForm.file?.name}
                            </p>
                            <span className="text-[10px] text-slate-400">Click para cambiar imagen</span>
                          </div>
                        ) : (
                          <div className="py-4">
                            <Upload className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                            <p className="text-xs font-semibold text-slate-300">
                              Arrastra o haz click para subir capture
                            </p>
                            <p className="text-[10px] text-slate-500 mt-1">PNG, JPG, JPEG de Pago Móvil o Transferencia</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Fecha y Referencia opcional (monto, banco y descripción eliminados para extracción automática) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                          Fecha
                        </label>
                        <input
                          type="date"
                          value={ocrForm.date}
                          onChange={(e) => setOcrForm({ ...ocrForm, date: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                          Referencia (Opcional)
                        </label>
                        <input
                          type="text"
                          placeholder="Detectada por IA"
                          value={ocrForm.reference}
                          onChange={(e) => setOcrForm({ ...ocrForm, reference: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/60 text-[11px] text-slate-400 space-y-1">
                      <p className="font-semibold text-slate-300">💡 Extracción inteligente automática:</p>
                      <p>• Monto en Bolívares extraído del capture.</p>
                      <p>• Conversión automática a USD dividiendo entre la tasa BCV ({dolarRates?.oficial ? `${dolarRates.oficial} Bs` : 'Cargando...'}).</p>
                      <p>• Detección automática del Banco Emisor y Banco Receptor.</p>
                    </div>

                    {ocrForm.ocrExtracted && (
                      <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-100 space-y-1">
                        <p className="font-semibold text-emerald-300">✓ Datos extraídos por OCR</p>
                        <p>Monto: <span className="font-semibold">Bs {Number(ocrForm.ocrExtracted.monto || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                        <p>Banco origen: <span className="font-semibold">{ocrForm.ocrExtracted.bancoOrigen || 'Desconocido'}</span></p>
                        <p>Banco destino: <span className="font-semibold">{ocrForm.ocrExtracted.bancoDestino || 'Desconocido'}</span></p>
                        <p>Referencia: <span className="font-semibold">{ocrForm.ocrExtracted.referencia || 'N/A'}</span></p>
                        {ocrForm.ocrExtracted.confianza && <p>Confianza: <span className="font-semibold">{ocrForm.ocrExtracted.confianza}</span></p>}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={ocrForm.processing}
                      className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      {ocrForm.processing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Analizando Comprobante con IA...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Escanear y Procesar Comprobante</span>
                        </>
                      )}
                    </button>
                  </form>
                </div>

                {/* Tabla de Transacciones con Filtros y Ordenamiento */}
                <div className={`lg:col-span-2 p-6 rounded-3xl border flex flex-col justify-between ${themeDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                      <h3 className="font-bold text-base text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-emerald-400" />
                        Registro Cronológico de Transacciones
                      </h3>

                      {/* Filtros: Búsqueda y Tipo (VENTA/COMPRA) */}
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <div className="relative flex-1 sm:w-44">
                          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Buscar ref, banco o monto (Bs/USD)..."
                            value={txSearch}
                            onChange={(e) => setTxSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                          />
                        </div>

                        <select
                          value={txTypeFilter}
                          onChange={(e) => setTxTypeFilter(e.target.value)}
                          className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                        >
                          <option value="todos">Todos los Tipos</option>
                          <option value="venta">VENTA USDT</option>
                          <option value="compra">COMPRA USDT</option>
                        </select>
                      </div>
                    </div>

                    {/* Tabla de Transacciones */}
                    <div className="overflow-x-auto rounded-2xl border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-800/80 text-slate-400 uppercase font-semibold border-b border-slate-700/60">
                          <tr>
                            <th onClick={() => toggleSort('date')} className="py-3 px-3 cursor-pointer hover:text-white transition-colors">
                              Fecha {txSortField === 'date' && (txSortDir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="py-3 px-2">Tipo</th>
                            <th onClick={() => toggleSort('bankOrigin')} className="py-3 px-3 cursor-pointer hover:text-white transition-colors">
                              Banco Emisor {txSortField === 'bankOrigin' && (txSortDir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th onClick={() => toggleSort('reference')} className="py-3 px-3 cursor-pointer hover:text-white transition-colors">
                              Referencia {txSortField === 'reference' && (txSortDir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th onClick={() => toggleSort('amountBs')} className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors">
                              Monto Bs {txSortField === 'amountBs' && (txSortDir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th onClick={() => toggleSort('amountUSD')} className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors">
                              Monto USD {txSortField === 'amountUSD' && (txSortDir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="py-3 px-3 text-center">Capture</th>
                            <th className="py-3 px-3 text-center">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-300">
                          {sortedTxs.length === 0 ? (
                            <tr>
                              <td colSpan="8" className="py-8 text-center text-slate-500">
                                No se encontraron transacciones registradas.
                              </td>
                            </tr>
                          ) : (
                            sortedTxs.map(tx => {
                              const isVenta = tx.type === 'venta';
                              const bcvRateUsed = tx.bcvRate || dolarRates?.oficial || 1;
                              const displayBs = tx.amountBs !== undefined
                                ? Number(tx.amountBs)
                                : (Number(tx.amount || 0) * bcvRateUsed);
                              const displayUSD = tx.amountUSD !== undefined
                                ? Number(tx.amountUSD)
                                : Number(tx.amount || 0);

                              return (
                                <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                                  <td className="py-3 px-3 font-medium whitespace-nowrap">{tx.date || 'N/A'}</td>
                                  <td className="py-3 px-2 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${isVenta ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                      }`}>
                                      {isVenta ? 'VENTA USDT' : 'COMPRA USDT'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 font-medium text-white whitespace-nowrap">
                                    {tx.bankOrigin || tx.bank || 'Desconocido'}
                                  </td>
                                  <td className="py-3 px-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                                    {tx.reference || 'N/A'}
                                  </td>
                                  <td className={`py-3 px-3 text-right font-extrabold whitespace-nowrap ${isVenta ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {isVenta ? '+' : '-'}{displayBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                                  </td>
                                  <td className="py-3 px-3 text-right font-bold text-white whitespace-nowrap">
                                    ${displayUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="py-3 px-3 text-center whitespace-nowrap">
                                    {tx.receiptUrl ? (
                                      <a
                                        href={tx.receiptUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                                      >
                                        <Eye className="w-3 h-3" />
                                        <span>Ver</span>
                                      </a>
                                    ) : (
                                      <span className="text-slate-600 text-[10px]">Sin capture</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-center whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteEcommerceTransaction(tx.id)}
                                      title="Eliminar registro"
                                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
                    <span>Total de transacciones listadas: {sortedTxs.length}</span>
                    <span>Ordenadas cronológicamente</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* TAB 7: AJUSTES Y LICENCIAS                                     */}
        {/* ============================================================== */}
        {activeTab === 'settings' && (() => {
          const handleExportAdminSettings = async () => {
            try {
              const res = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': currentUser.id
                },
                body: JSON.stringify({ action: 'export_settings' })
              });
              const data = await res.json();
              if (!data.success || !data.export) {
                notify(data.error || 'No se pudo exportar la configuración', 'error');
                return;
              }
              const json = JSON.stringify(data.export, null, 2);
              const blob = new Blob([json], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const stamp = (data.export?.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-');
              const a = document.createElement('a');
              a.href = url;
              a.download = `crediflux-snapshot-ajustes-admin-${stamp}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);

              const meta = data.export || {};
              const moduleCount = Object.keys(meta.modules || {}).length;
              const tableCount = meta.tableCount ?? Object.keys(meta.summary || {}).length;
              const recordCount = meta.recordCount ?? 0;
              notify(
                `Respaldo exportado: ${moduleCount} módulos, ${tableCount} tablas y ${recordCount} registros ` +
                `(esquema ${meta.schemaVersion || 'actual'}).`
              );
            } catch (err) {
              notify('Error de red al exportar configuraciones', 'error');
            }
          };

          const handleImportAdminSettingsFile = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (!file.name.toLowerCase().endsWith('.json')) {
                notify('Selecciona un archivo .json válido', 'error');
                return;
              }
              const text = await file.text();
              let parsed;
              try {
                parsed = JSON.parse(text);
              } catch {
                notify('El archivo no contiene un JSON válido', 'error');
                return;
              }
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                notify('Estructura de archivo inválida', 'error');
                return;
              }

              const targetData = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data))
                ? parsed.data
                : parsed;
              const isDynamicBackup = targetData?.format === 'crediflux.system-backup';
              const modules = targetData?.modules && typeof targetData.modules === 'object' ? targetData.modules : {};
              const moduleLines = Object.entries(modules)
                .map(([name, info]) => `• ${name}: ${(info?.tables || []).length} tabla(s), ${info?.recordCount || 0} registros`)
                .join('\n');
              const tableCount = targetData?.tableCount ?? Object.keys(targetData?.summary || {}).length;
              const recordCount = targetData?.recordCount ?? 0;

              const details = isDynamicBackup
                ? `Módulos detectados (${Object.keys(modules).length}):${moduleLines ? '\n' + moduleLines : ' ninguno'}\n\n` +
                  `Tablas: ${tableCount} · Registros: ${recordCount}\nEsquema de origen: ${targetData.schemaVersion || 'desconocido'}`
                : `Respaldo de formato anterior.\n` +
                  `Usuarios: ${Array.isArray(targetData?.users) ? targetData.users.length : 0} · ` +
                  `Patrones: ${Array.isArray(targetData?.receiptPatterns) ? targetData.receiptPatterns.length : 0}`;

              const confirmMessage = `¿Restaurar este respaldo del sistema?\n\n${details}\n\n` +
                `Se reemplazarán únicamente las tablas incluidas en el archivo; las tablas nuevas se conservarán ` +
                `con sus valores actuales. La restauración es atómica: cualquier fallo revierte todos los cambios. ` +
                `¿Deseas continuar?`;

              if (!confirm(confirmMessage)) {
                return;
              }

              const payload = { action: 'import_settings', importData: parsed };
              const body = JSON.stringify(payload);
              // Vercel/Next serverless functions have request body size limits; warn early on large snapshots (e.g. base64 images).
              const bodySizeBytes = new Blob([body]).size;
              const maxRecommendedBytes = 4 * 1024 * 1024; // ~4MB safe threshold for common plans
              if (bodySizeBytes > maxRecommendedBytes) {
                const sizeMb = (bodySizeBytes / (1024 * 1024)).toFixed(2);
                if (!confirm(`El archivo a importar es grande (~${sizeMb} MB) y puede exceder el límite de carga permitido en producción (Vercel). ¿Deseas intentar la importación de todas formas?`)) {
                  return;
                }
              }

              const res = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': currentUser.id
                },
                body
              });

              let data = null;
              const contentType = res.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                data = await res.json().catch(() => null);
              } else {
                const text = await res.text().catch(() => '');
                data = text ? { success: false, error: text.slice(0, 300) } : null;
              }

              if (!res.ok) {
                const statusMsg = res.status === 413
                  ? 'El archivo es demasiado grande para el servidor (límite de payload). Reduce imágenes embebidas en patrones o divide la importación.'
                  : (data?.error || `Error del servidor (${res.status}) al importar la configuración`);
                notify(statusMsg, 'error');
                return;
              }

              if (data?.success) {
                if (data.settings) setSettings(data.settings);
                if (data.imported?.activeOcrProvider || data.settings?.aiProvider) {
                  setOcrProvider(data.imported?.activeOcrProvider || data.settings?.aiProvider);
                }
                if (data.settings?.ocrKeys) {
                  setOcrProviderKeys(data.settings.ocrKeys);
                }
                if (Array.isArray(data.users)) {
                  setAdminUsersList(data.users);
                }
                if (Array.isArray(data.receiptPatterns)) {
                  setReceiptPatterns(data.receiptPatterns);
                }
                if (data.settings?.ocrEndpoints) {
                  setOcrEndpointsForm(prev => ({ ...prev, ...data.settings.ocrEndpoints }));
                }
                if (data.settings?.ocrModels) {
                  setOcrModelsForm(prev => ({ ...prev, ...data.settings.ocrModels }));
                }
                if (data.settings?.ocrThresholds) {
                  setOcrThresholdsForm(prev => ({
                    ...prev,
                    ...data.settings.ocrThresholds,
                    ocrConfidenceMin: data.settings.ocrConfidenceMin ?? prev.ocrConfidenceMin
                  }));
                }
                if (data.activeAdmin) {
                  const activeAdmin = data.activeAdmin;
                  setCurrentUser(prev => {
                    const merged = { ...(prev || {}), ...activeAdmin };
                    try {
                      localStorage.setItem('crediflux_user', JSON.stringify(merged));
                      localStorage.setItem('ricardo_user', JSON.stringify(merged));
                    } catch (e) {}
                    return merged;
                  });
                }
                const importedInfo = data.imported || {};
                const warningSuffix = Array.isArray(importedInfo.warnings) && importedInfo.warnings.length
                  ? ` (${importedInfo.warnings.length} avisos)`
                  : '';
                notify(
                  data.message ||
                  `Respaldo restaurado: ${importedInfo.tableCount || 0} tablas, ` +
                  `${importedInfo.skippedRows || 0} filas omitidas${warningSuffix}.`
                );
                await fetchAllData();
              } else {
                notify(data?.error || 'No se pudo importar la configuración', 'error');
              }
            } catch (err) {
              console.error('Error importando ajustes:', err);
              notify(`Error al importar configuraciones: ${err?.message || 'fallo de red o lectura del archivo'}`, 'error');
            } finally {
              if (importSettingsInputRef.current) importSettingsInputRef.current.value = '';
            }
          };

          return (
          <div className="max-w-6xl mx-auto space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>{currentUser?.role === 'admin' ? 'Ajustes de Administrador' : 'Mi Cuenta y Licencia'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">CrediFlux Core</span>
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                {currentUser?.role === 'admin'
                  ? 'Panel exclusivo del administrador: registro y gestión de usuarios, supervisión de claves, licencias comerciales y configuración del motor multimodal de IA.'
                  : 'Plataforma unificada CrediFlux: administra tus credenciales y consulta el estado y vigencia de tu licencia.'}
              </p>
            </div>

            {/* BARRA DE CONSUMO DE LICENCIA */}
            <div className={settingsCardCls}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <h4 className={settingsCardTitleCls}>
                    <Key className="w-4 h-4 text-emerald-400" />
                    Estado de Licencia
                  </h4>
                  <p className={`${settingsDescCls} mt-1`}>
                    Licencia: <strong className="text-emerald-400 font-mono">{currentUser?.licenseKey || 'MASTER-ADMIN'}</strong> • Plataforma: <strong className="text-white">CrediFlux Core</strong>
                  </p>
                </div>
                <div className="text-right">
                  {currentUser?.role === 'admin' ? (
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      ADMINISTRADOR • ILIMITADO
                    </span>
                  ) : (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${licenseProgress.isExpired
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      }`}>
                      {licenseProgress.isExpired ? 'CADUCADA' : `${licenseProgress.daysLeft} DÍAS RESTANTES`}
                    </span>
                  )}
                </div>
              </div>

              {currentUser?.role !== 'admin' && (
                <div className="space-y-1.5 mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Vigencia disponible:</span>
                    <span className={licenseProgress.isExpired ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {licenseProgress.percent}% activo ({licenseProgress.daysLeft} de {licenseProgress.totalDays} días)
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${licenseProgress.isExpired
                        ? 'bg-rose-500'
                        : licenseProgress.percent < 25
                          ? 'bg-amber-400'
                          : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        }`}
                      style={{ width: `${licenseProgress.percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                    <span>Fecha de Asignación: {currentUser?.licenseAssignedAt ? new Date(currentUser.licenseAssignedAt).toLocaleDateString() : 'N/A'}</span>
                    <span>Fecha Límite: {currentUser?.licenseExpiresAt ? new Date(currentUser.licenseExpiresAt).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </div>
              )}

              {currentUser?.role !== 'admin' && (
                <div className={`mt-4 p-3 rounded-xl border text-xs text-slate-300 ${settingsSubcardTheme}`}>
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
                    <Phone className="w-3.5 h-3.5" />
                    <span>Contacto Administrador del Sistema:</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Teléfono: <strong className="text-white font-medium">+58 412-6770824</strong> • Correo: <strong className="text-white font-medium">Oswaldoserrano18@gmail.com</strong>
                  </p>
                </div>
              )}
            </div>

            {/* USUARIO FINAL: INGRESAR NUEVA LICENCIA Y CAMBIAR CLAVE */}
            {currentUser?.role !== 'admin' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={settingsCardCls}>
                  <h4 className={`${settingsCardTitleCls} mb-2`}>
                    <Key className="w-4 h-4 text-emerald-400" />
                    Activar Nueva Licencia
                  </h4>
                  <p className={`${settingsDescCls} mb-4`}>
                    Ingresa el código suministrado por el administrador para reactivar o extender tu sistema.
                  </p>

                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const res = await fetch('/api/auth', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'activate_license',
                            userId: currentUser.id,
                            licenseKey: renewLicenseKey
                          })
                        });
                        const d = await res.json();
                        if (d.success) {
                          notify('¡Licencia activada con éxito!');
                          setRenewLicenseKey('');
                          fetchAllData();
                        } else {
                          notify(d.error || 'Error al validar la licencia', 'error');
                        }
                      } catch (err) {
                        notify('Error de red', 'error');
                      }
                    }}
                    className="space-y-3"
                  >
                    <div>
                      <input
                        type="text"
                        required
                        placeholder="RIC-XXXX-XXXX-XXXX"
                        value={renewLicenseKey}
                        onChange={(e) => setRenewLicenseKey(e.target.value)}
                        className={`${settingsInputCls} font-mono text-center font-semibold tracking-wider`}
                      />
                    </div>
                    <button
                      type="submit"
                      className={`${settingsPrimaryBtnCls} w-full`}
                    >
                      Validar & Activar Licencia
                    </button>
                  </form>
                </div>

                <div className={settingsCardCls}>
                  <h4 className={`${settingsCardTitleCls} mb-2`}>
                    <Lock className="w-4 h-4 text-emerald-400" />
                    Cambiar Mi Clave de Acceso
                  </h4>
                  <p className={`${settingsDescCls} mb-4`}>
                    Actualiza tu contraseña personal para acceder a tu sesión.
                  </p>

                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      const newPassword = fd.get('newPassword');
                      try {
                        const res = await fetch('/api/auth', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'change_password',
                            userId: currentUser.id,
                            newPassword
                          })
                        });
                        const d = await res.json();
                        if (d.success) {
                          notify('Contraseña cambiada con éxito');
                          e.target.reset();
                        } else {
                          notify(d.error || 'Error al cambiar contraseña', 'error');
                        }
                      } catch (err) {
                        notify('Error de red', 'error');
                      }
                    }}
                    className="space-y-3"
                  >
                    <div>
                      <input
                        type="password"
                        required
                        name="newPassword"
                        placeholder="Nueva contraseña (mínimo 4 caracteres)"
                        className={settingsInputCls}
                      />
                    </div>
                    <button
                      type="submit"
                      className={`${settingsSecondaryBtnCls} w-full`}
                    >
                      Actualizar Mi Contraseña
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* ========================================================= */}
            {/* VISTA EXCLUSIVA DE ADMINISTRADOR                          */}
            {/* ========================================================= */}
            {currentUser?.role === 'admin' && (
              <>
                {/* RESPALDO Y MIGRACIÓN DINÁMICA DEL SISTEMA */}
                <div className={`${settingsCardCls} space-y-4`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className={settingsTitleCls}>
                        <FileText className="w-5 h-5 text-sky-400" />
                        Respaldo y Migración del Sistema (Snapshot Integral)
                      </h3>
                      <p className={`${settingsDescCls} mt-1`}>
                        El snapshot descubre automáticamente todas las tablas y configuraciones activas al momento de exportar. Incluye versión de esquema, timestamp y metadatos por módulo; los módulos futuros se incorporan sin cambios en el código.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 py-1">
                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
                      <Users className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-white block">Descubrimiento dinámico</span>
                        <span className="text-[11px] text-slate-400">Tablas, columnas y relaciones se leen del catálogo de PostgreSQL.</span>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-white block">Restauración ordenada</span>
                        <span className="text-[11px] text-slate-400">Dependencias resueltas por llaves foráneas; padres antes que hijos.</span>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-white block">Transacción atómica</span>
                        <span className="text-[11px] text-slate-400">Cualquier fallo revierte todos los cambios; módulos nuevos se conservan.</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={handleExportAdminSettings}
                      className={settingsSecondaryBtnCls}
                    >
                      Exportar Respaldo (.json)
                    </button>
                    <button
                      type="button"
                      onClick={() => importSettingsInputRef.current?.click()}
                      className={settingsPrimaryBtnCls}
                    >
                      Importar Respaldo (.json)
                    </button>
                    <input
                      ref={importSettingsInputRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={handleImportAdminSettingsFile}
                      className="hidden"
                    />
                  </div>
                  <p className={settingsHelperCls}>
                    La importación valida versión y estructura, ignora tablas obsoletas, conserva los valores actuales de los módulos nuevos y aplica todos los cambios en una sola transacción con rollback completo ante cualquier error.
                  </p>
                </div>

              <div className="space-y-5">
                {/* 1. LISTADO DE USUARIOS FINALES + BOTÓN DE REGISTRAR NUEVO USUARIO */}
                <div className={settingsCardCls}>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className={settingsTitleCls}>
                        <Users className="w-5 h-5 text-emerald-400" />
                        Usuarios del Sistema ({adminUsersList.filter(u => u.role !== 'admin').length})
                      </h3>
                      <p className={`${settingsDescCls} mt-1`}>
                        Supervisión integral de usuarios: gestión de credenciales, licencias comerciales y acceso unificado a CrediFlux.
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        handleAdminGenerateLicense(1);
                        setNewUserModal(true);
                      }}
                      className={settingsPrimaryBtnCls}
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Registrar Nuevo Usuario</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className={`border-b border-slate-800 ${settingsTableHeadCls}`}>
                        <tr>
                          <th className="py-3 px-4">Usuario / Nombre</th>
                          <th className="py-3 px-4">Clave de Acceso</th>
                          <th className="py-3 px-4">Licencia</th>
                          <th className="py-3 px-4">Caducidad</th>
                          <th className="py-3 px-4">Estado</th>
                          <th className="py-3 px-4 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {adminUsersList.map(u => {
                          const isExpired = checkIsExpired(u);
                          return (
                            <tr key={u.id} className="hover:bg-slate-800/30">
                              <td className="py-3.5 px-4">
                                <div className="text-sm font-semibold text-white">{u.name}</div>
                                <span className="text-xs text-slate-400">@{u.username}</span>
                                {u.role === 'admin' && (
                                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300">ADMIN</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-emerald-300 font-semibold">
                                <div className="flex items-center gap-2">
                                  <span className="select-none">
                                    {revealedPassword?.userId === u.id && revealedPassword.password
                                      ? revealedPassword.password
                                      : revealedPassword?.userId === u.id && revealedPassword.loading
                                        ? 'Consultando…'
                                        : '••••••••'}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={!u.hasPassword}
                                    title={revealedPassword?.userId === u.id && revealedPassword.password ? 'Ocultar clave' : 'Ver clave'}
                                    aria-label={revealedPassword?.userId === u.id && revealedPassword.password ? 'Ocultar clave' : 'Ver clave'}
                                    aria-pressed={Boolean(revealedPassword?.userId === u.id && revealedPassword.password)}
                                    onClick={() => togglePassword(u)}
                                    className="inline-flex items-center justify-center p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-700/50 transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {revealedPassword?.userId === u.id && revealedPassword.loading
                                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      : revealedPassword?.userId === u.id && revealedPassword.password
                                        ? <EyeOff className="w-3.5 h-3.5" />
                                        : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                {revealedPassword?.userId === u.id && revealedPassword.password && (
                                  <div className="mt-1 text-[10px] font-sans font-normal text-slate-500 normal-case">
                                    Se oculta automáticamente en 15 s
                                  </div>
                                )}
                                {revealedPassword?.userId === u.id && !revealedPassword.password && !revealedPassword.loading && revealedPassword.reason && (
                                  <div className="mt-1 text-[10px] font-sans font-normal text-amber-400 normal-case">
                                    {revealedPassword.reason === 'hash'
                                      ? 'Clave con hash: cámbiala para poder verla'
                                      : revealedPassword.reason === 'unavailable'
                                        ? 'Vista previa no configurada en el servidor'
                                        : 'No se pudo consultar la clave'}
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-300">
                                {u.licenseKey || 'N/A'}
                              </td>
                              <td className="py-3.5 px-4 text-slate-300">
                                {u.role === 'admin' ? 'Vitalicio' : (u.licenseExpiresAt ? new Date(u.licenseExpiresAt).toLocaleDateString() : 'Sin fecha')}
                              </td>
                              <td className="py-3.5 px-4">
                                {u.role === 'admin' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    Activo
                                  </span>
                                ) : (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${isExpired
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    }`}>
                                    {isExpired ? 'CADUCADA' : 'ACTIVA'}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  {u.role === 'admin' ? (
                                    <button
                                      onClick={() => setEditUserModal({ open: true, user: u, passwordOnly: true })}
                                      className={settingsTableBtnCls}
                                    >
                                      Editar clave
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setEditUserModal({ open: true, user: u })}
                                      className={settingsTableBtnCls}
                                    >
                                      Editar
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setPurgeModal({
                                      open: true,
                                      user: u,
                                      targets: { ...EMPTY_PURGE_TARGETS },
                                      filter: { period: 'all', day: '', month: '', year: '', until: '' },
                                      processing: false
                                    })}
                                    className={settingsTableDangerBtnCls}
                                    title="Vaciar datos (granular y por fecha)"
                                  >
                                    Vaciar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. CONFIGURACIÓN DEL SISTEMA Y PROVEEDOR DE IA AUTOMÁTICO (SOLO ADMIN) */}
                {/* Los campos de 'Nombre de la empresa' y 'Capital asignado' fueron removidos como se solicitó */}
                <div className={`${settingsCardCls} space-y-4`}>
                  <div>
                    <h3 className={settingsTitleCls}>
                      <Shield className="w-5 h-5 text-emerald-400" />
                      Parámetros Generales & Asignación Automática de IA
                    </h3>
                    <p className={`${settingsDescCls} mt-1`}>
                      El motor de Inteligencia Artificial que configures aquí se aplicará de forma automática y transparente a todos los usuarios del sistema sin que ellos deban configurarlo.
                    </p>
                  </div>

                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      const selectedProvider = String(fd.get('aiProvider') || ocrProvider);
                      // Se envían todas las credenciales por proveedor para persistencia independiente
                      const payload = {
                        adminPassword: fd.get('adminPassword') || undefined,
                        aiProvider: selectedProvider,
                        ocrKeys: {
                          openai: String(ocrProviderKeys.openai || '').trim(),
                          gemini: String(ocrProviderKeys.gemini || '').trim(),
                          ocrspace: String(ocrProviderKeys.ocrspace || '').trim(),
                          tesseract: ''
                        },
                        ocrEndpoints: ocrEndpointsForm,
                        ocrModels: ocrModelsForm,
                        ocrThresholds: ocrThresholdsForm,
                        ocrConfidenceMin: Number(ocrThresholdsForm.ocrConfidenceMin) || 0.8
                      };

                      try {
                        const res = await fetch('/api/settings', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'x-user-id': currentUser.id
                          },
                          body: JSON.stringify(payload)
                        });
                        const d = await res.json();
                        if (d.success) {
                          notify('Parámetros de administración y motor de IA guardados');
                          fetchAllData();
                        } else {
                          notify(d.error || 'Error al guardar', 'error');
                        }
                      } catch (err) {
                        notify('Error de red', 'error');
                      }
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className={settingsLabelCls}>Cambiar Clave de Administrador Maestro</label>
                      <input
                        type="password"
                        name="adminPassword"
                        placeholder="Dejar en blanco para conservar la actual"
                        className={settingsInputCls}
                      />
                    </div>

                    {/* MOTOR OCR (Asignación centralizada exclusiva del Admin) */}
                    <div className="p-4 rounded-xl bg-teal-500/5 border border-teal-500/20 space-y-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-teal-400" />
                        <h4 className="text-sm font-semibold text-white">MOTOR OCR (Asignación Automática Global con Respaldo)</h4>
                      </div>

                      {(() => {
                        const provider = ['openai', 'gemini', 'ocrspace', 'tesseract'].includes(ocrProvider) ? ocrProvider : 'openai';
                        const providerNeedsEditableKey = provider === 'ocrspace' || provider === 'openai' || provider === 'gemini';
                        const isInternalNoKeyProvider = provider === 'tesseract';
                        const internalLicense = settings?.internalOcrLicenses?.[provider];
                        const internalLicenseLabel = internalLicense?.label
                          || 'Licencia interna: No requerida (motor local integrado, sin límites de API)';
                        const currentKey = String(ocrProviderKeys?.[provider] || '');
                        const hasCurrentKey = Boolean(currentKey);

                        return (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className={settingsLabelCls}>Proveedor OCR activo</label>
                                <select
                                  name="aiProvider"
                                  value={provider}
                                  onChange={(e) => {
                                    setOcrProvider(e.target.value);
                                    setOcrConnectionTest({ status: 'idle', message: '' });
                                  }}
                                  className={settingsInputCls}
                                >
                                  <option value="ocrspace">OCR.space (API)</option>
                                  <option value="openai">OpenAI (GPT-4o-mini Vision)</option>
                                  <option value="gemini">Google Gemini (Gemini 1.5 Flash)</option>
                                  <option value="tesseract">Tesseract.js (Motor Local Gratuito, sin API)</option>
                                </select>
                                <p className={`${settingsHelperCls} mt-1`}>
                                  Al cambiar de proveedor se autocompleta su propia credencial/configuración guardada. Si un proveedor falla o alcanza su límite, cambia de proveedor y guarda para continuar.
                                </p>
                              </div>

                              <div>
                                {isInternalNoKeyProvider ? (
                                  <div className="h-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                      <span className="text-xs font-bold text-emerald-300 uppercase tracking-wide">Licencia interna activa</span>
                                    </div>
                                    <p className="text-xs text-emerald-100/90 leading-relaxed">{internalLicenseLabel}</p>
                                    <p className="text-[11px] text-emerald-200/70 mt-1">No requiere API key. Lista para usarse y probarse de inmediato.</p>
                                  </div>
                                ) : (
                                  <>
                                    <label className={settingsLabelCls}>
                                      API Key{hasCurrentKey ? ' • (Guardada y cargada)' : ''}
                                    </label>
                                    <input
                                      type="text"
                                      name="ocrProviderApiKey"
                                      value={currentKey}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        setOcrProviderKeys(prev => ({ ...prev, [provider]: value }));
                                        setOcrConnectionTest({ status: 'idle', message: '' });
                                      }}
                                      placeholder={
                                        provider === 'ocrspace'
                                          ? 'Clave de OCR.space'
                                          : provider === 'gemini'
                                            ? 'AIza...'
                                            : 'sk-...'
                                      }
                                      autoComplete="off"
                                      className={settingsInputCls}
                                    />
                                    <p className={`${settingsHelperCls} mt-1`}>
                                      Cada proveedor mantiene su credencial guardada de forma independiente. Puedes editarla y guardar los cambios.
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Acción de verificación previa a la persistencia */}
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                disabled={testingConnection}
                                onClick={async () => {
                                  setTestingConnection(true);
                                  setOcrConnectionTest({ status: 'testing', message: 'Probando conexión...' });
                                  const started = performance.now();
                                  const controller = new AbortController();
                                  const timeoutId = setTimeout(() => controller.abort(), 55000);
                                  try {
                                    const res = await fetch('/api/settings', {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        'x-user-id': currentUser.id
                                      },
                                      body: JSON.stringify({
                                        testProviderConnection: provider,
                                        testApiKey: providerNeedsEditableKey ? String(ocrProviderKeys?.[provider] || '').trim() : ''
                                      }),
                                      signal: controller.signal
                                    });
                                    const rawBody = await res.text();
                                    let d = null;
                                    try {
                                      d = rawBody ? JSON.parse(rawBody) : null;
                                    } catch {
                                      d = null;
                                    }
                                    const clientMs = Math.round(performance.now() - started);
                                    if (!d) {
                                      const fallback = res.status === 504
                                        ? 'El servidor agotó el tiempo de ejecución (timeout de Vercel). Verifica el worker y los traineddata de Tesseract.js.'
                                        : `Respuesta inválida del servidor (HTTP ${res.status})`;
                                      setOcrConnectionTest({ status: 'error', message: `${fallback} • ${clientMs} ms` });
                                      return;
                                    }
                                    const responseMs = Number.isFinite(d.responseTimeMs) ? d.responseTimeMs : clientMs;
                                    const baseMsg = d.success ? (d.message || `Conexión exitosa con ${provider}`) : (d.error || 'Fallo de conexión');
                                    setOcrConnectionTest({
                                      status: d.success ? 'success' : 'error',
                                      message: `${baseMsg} • ${responseMs} ms`
                                    });
                                  } catch (err) {
                                    const clientMs = Math.round(performance.now() - started);
                                    const msg = err?.name === 'AbortError'
                                      ? 'La prueba superó 55 s sin respuesta del servidor (posible bloqueo del worker OCR)'
                                      : 'Error de red al probar la conexión';
                                    setOcrConnectionTest({ status: 'error', message: `${msg} • ${clientMs} ms` });
                                  } finally {
                                    clearTimeout(timeoutId);
                                    setTestingConnection(false);
                                  }
                                }}
                                className={`${settingsSecondaryBtnCls} whitespace-nowrap`}
                              >
                                {testingConnection ? 'Probando conexión...' : 'Probar Conexión'}
                              </button>

                              {isInternalNoKeyProvider && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-semibold text-emerald-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                  Configuración interna aplicada automáticamente
                                </span>
                              )}

                              {ocrConnectionTest.status !== 'idle' && (
                                <p className={`text-xs font-semibold ${ocrConnectionTest.status === 'success' ? 'text-emerald-400' : ocrConnectionTest.status === 'testing' ? 'text-slate-300' : 'text-rose-400'}`}>
                                  {ocrConnectionTest.status === 'testing'
                                    ? 'Probando conexión y validando el proveedor seleccionado...'
                                    : `${ocrConnectionTest.status === 'success' ? '✓ Éxito' : '✗ Error'}: ${ocrConnectionTest.message}`}
                                </p>
                              )}
                            </div>

                            {/* Parámetros Avanzados del Motor OCR (Endpoints, Modelos y Umbrales) */}
                            <div className="pt-2 border-t border-teal-500/20">
                              <button
                                type="button"
                                onClick={() => setOcrAdvancedOpen(!ocrAdvancedOpen)}
                                className="text-xs font-semibold text-teal-300 hover:text-teal-200 flex items-center gap-1.5 transition-colors"
                              >
                                <span>{ocrAdvancedOpen ? '▼ Ocultar Parámetros Avanzados de OCR' : '► Configurar Endpoints, Modelos y Umbrales de Validación'}</span>
                              </button>

                              {ocrAdvancedOpen && (
                                <div className="mt-3 p-3.5 rounded-lg bg-slate-900/70 border border-teal-500/20 space-y-3.5">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                      <label className={settingsLabelCls}>Endpoint API ({provider})</label>
                                      <input
                                        type="text"
                                        value={ocrEndpointsForm[provider] || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setOcrEndpointsForm(prev => ({ ...prev, [provider]: val }));
                                        }}
                                        placeholder={
                                          provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' :
                                          provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models' :
                                          provider === 'ocrspace' ? 'https://api.ocr.space/parse/image' : 'local'
                                        }
                                        className={settingsInputCls}
                                      />
                                      <p className={`${settingsHelperCls} mt-1`}>Endpoint HTTP del motor o proxy de inferencia.</p>
                                    </div>
                                    <div>
                                      <label className={settingsLabelCls}>Modelo / Motor Seleccionado ({provider})</label>
                                      <input
                                        type="text"
                                        value={ocrModelsForm[provider] || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setOcrModelsForm(prev => ({ ...prev, [provider]: val }));
                                        }}
                                        placeholder={
                                          provider === 'openai' ? 'gpt-4o-mini' :
                                          provider === 'gemini' ? 'gemini-1.5-flash' :
                                          provider === 'ocrspace' ? 'Engine2' : 'spa+eng'
                                        }
                                        className={settingsInputCls}
                                      />
                                      <p className={`${settingsHelperCls} mt-1`}>Identificador del modelo multimodal o motor de lectura.</p>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                                    <div>
                                      <label className={settingsLabelCls}>
                                        Umbral Mínimo de Confianza ({Math.round((Number(ocrThresholdsForm.ocrConfidenceMin) || 0.8) * 100)}%)
                                      </label>
                                      <input
                                        type="range"
                                        min="0.5"
                                        max="0.99"
                                        step="0.05"
                                        value={ocrThresholdsForm.ocrConfidenceMin ?? 0.8}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value);
                                          setOcrThresholdsForm(prev => ({ ...prev, ocrConfidenceMin: val }));
                                        }}
                                        className="w-full accent-teal-400 cursor-pointer"
                                      />
                                      <p className={`${settingsHelperCls} mt-1`}>Mínima certeza estadística para validar el comprobante automáticamente.</p>
                                    </div>
                                    <div className="flex flex-col justify-center space-y-2">
                                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                                        <input
                                          type="checkbox"
                                          checked={ocrThresholdsForm.requireReferenceMatch !== false}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            setOcrThresholdsForm(prev => ({ ...prev, requireReferenceMatch: checked }));
                                          }}
                                          className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-950"
                                        />
                                        <span>Exigir formato de referencia según patrón bancario</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(ocrThresholdsForm.strictBankMatch)}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            setOcrThresholdsForm(prev => ({ ...prev, strictBankMatch: checked }));
                                          }}
                                          className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-950"
                                        />
                                        <span>Validación estricta de banco emisor registrado</span>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            <p className={settingsHelperCls}>
                              El proveedor seleccionado se aplica al escáner de comprobantes y devuelve una estructura estandarizada (texto, monto, referencia, fecha y banco). Las credenciales se guardan por proveedor de forma independiente para permitir failover inmediato.
                            </p>
                          </>
                        );
                      })()}
                    </div>

                    <button
                      type="submit"
                      className={`${settingsPrimaryBtnCls} w-full`}
                    >
                      Guardar Parámetros de Administrador & IA
                    </button>
                  </form>
                </div>

                {/* 3. CONFIGURACIÓN GLOBAL DE NIVELES DE CONFIANZA DE CLIENTES */}
                {(() => {
                  const trustConfig = getTrustLevelConfig(settings);
                  const levelCards = [
                    {
                      key: 'alto',
                      icon: CheckCircle,
                      tone: 'emerald',
                      thresholdName: 'altoMaxDelayDays',
                      thresholdLabel: 'Días máximos de retraso permitidos'
                    },
                    {
                      key: 'medio',
                      icon: Clock,
                      tone: 'blue',
                      thresholdName: 'mediaMaxDelayDays',
                      thresholdLabel: 'Días máximos para retraso leve'
                    },
                    {
                      key: 'riesgoso',
                      icon: AlertTriangle,
                      tone: 'rose',
                      thresholdName: 'riesgoMaxDelayDays',
                      thresholdLabel: 'Días de retraso que activan el riesgo'
                    }
                  ];
                  const toneClasses = {
                    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                  };

                  return (
                    <div className={`${settingsCardCls} space-y-4`}>
                      <div>
                        <h3 className={settingsTitleCls}>
                          <ShieldCheck className="w-5 h-5 text-emerald-400" />
                          Configuración de Niveles de Confianza
                        </h3>
                        <p className={`${settingsDescCls} mt-1`}>
                          Define las reglas globales aplicadas automáticamente al módulo de Clientes. Los cambios afectan a todos los usuarios del sistema.
                        </p>
                      </div>

                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-300/90">
                        Regla fija del sistema: si un cliente tiene cuotas vencidas sin pagar, se clasifica automáticamente como <strong>Riesgosa</strong>, sin importar los umbrales configurados.
                      </div>

                      <form
                        key={JSON.stringify(trustConfig)}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          const payload = {
                            trustLevelConfig: {
                              levels: {
                                alto: { label: fd.get('altoLabel'), description: fd.get('altoDescription') },
                                medio: { label: fd.get('medioLabel'), description: fd.get('medioDescription') },
                                riesgoso: { label: fd.get('riesgosoLabel'), description: fd.get('riesgosoDescription') }
                              },
                              thresholds: {
                                altoMaxDelayDays: fd.get('altoMaxDelayDays'),
                                mediaMaxDelayDays: fd.get('mediaMaxDelayDays'),
                                riesgoMaxDelayDays: fd.get('riesgoMaxDelayDays')
                              }
                            }
                          };

                          try {
                            const res = await fetch('/api/settings', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'x-user-id': currentUser.id
                              },
                              body: JSON.stringify(payload)
                            });
                            const d = await res.json();
                            if (d.success) {
                              notify('Niveles de confianza actualizados globalmente');
                              fetchAllData();
                            } else {
                              notify(d.error || 'Error al guardar los niveles de confianza', 'error');
                            }
                          } catch (err) {
                            notify('Error de red al guardar los niveles de confianza', 'error');
                          }
                        }}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {levelCards.map(card => {
                            const Icon = card.icon;
                            const level = trustConfig.levels[card.key];
                            return (
                              <div key={card.key} className={`rounded-xl border p-4 space-y-3 ${settingsSubcardTheme}`}>
                                <div className="flex items-center gap-2">
                                  <span className={`p-1.5 rounded-lg border ${toneClasses[card.tone]}`}>
                                    <Icon className="w-4 h-4" />
                                  </span>
                                  <h4 className={settingsCardTitleCls}>{level.label}</h4>
                                </div>

                                <div>
                                  <label className={settingsLabelCls}>Nombre del nivel</label>
                                  <input
                                    type="text"
                                    name={`${card.key}Label`}
                                    defaultValue={level.label}
                                    maxLength={32}
                                    className={settingsInputCls}
                                  />
                                </div>

                                <div>
                                  <label className={settingsLabelCls}>Regla / descripción</label>
                                  <textarea
                                    name={`${card.key}Description`}
                                    defaultValue={level.description}
                                    rows={3}
                                    maxLength={240}
                                    className={settingsTextareaCls}
                                  />
                                </div>

                                <div>
                                  <label className={settingsLabelCls}>{card.thresholdLabel}</label>
                                  <div className="relative">
                                    <input
                                      type="number"
                                      name={card.thresholdName}
                                      defaultValue={trustConfig.thresholds[card.thresholdName]}
                                      min="0"
                                      max={card.key === 'riesgoso' ? 365 : 120}
                                      className={`${settingsInputCls} pr-14 font-semibold`}
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-500">días</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            className={settingsPrimaryBtnCls}
                          >
                            <Save className="w-4 h-4" />
                            <span>Guardar Niveles de Confianza</span>
                          </button>
                        </div>
                      </form>
                    </div>
                  );
                })()}

                {/* 4. BASE DE DATOS DE PATRONES DE COMPROBANTES PARA VALIDACIÓN CRUZADA OCR */}
                <div className={`${settingsCardCls} space-y-4`}>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <h3 className={settingsTitleCls}>
                        <Building className="w-5 h-5 text-emerald-400" />
                        Base de Patrones de Comprobantes (Validación Cruzada OCR)
                      </h3>
                      <p className={`${settingsDescCls} mt-1`}>
                        Carga capturas modelo y bancos emisores oficiales para comparar y asegurar la identificación exacta del banco y montos en el OCR.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPatternModal(true)}
                      className={settingsPrimaryBtnCls}
                    >
                      <Plus className="w-4 h-4" />
                      <span>Cargar Nuevo Patrón</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {receiptPatterns.length === 0 ? (
                      <div className="col-span-full py-8 text-center text-slate-500 text-xs">
                        No hay patrones registrados. Registra uno para entrenar la validación cruzada.
                      </div>
                    ) : (
                      receiptPatterns.map(pat => (
                        <div
                          key={pat.id}
                          className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 ${settingsSubcardTheme}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-semibold text-emerald-400 text-xs">
                                {pat.bankName.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-white">{pat.bankName}</h4>
                                <span className="text-[11px] text-slate-400 block font-mono">
                                  Ref: {pat.referenceFormat || '6-12 dígitos'}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDeleteReceiptPattern(pat.id)}
                              title="Eliminar patrón"
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {pat.imageUrl && (
                            <div className="rounded-xl overflow-hidden border border-slate-700 max-h-32 bg-slate-900/60 flex items-center justify-center">
                              <img
                                src={pat.imageUrl}
                                alt={pat.bankName}
                                className="max-h-32 object-contain"
                              />
                            </div>
                          )}

                          <div className="space-y-1 text-xs text-slate-400">
                            {pat.notes && <p className="italic text-slate-300">"{pat.notes}"</p>}
                            {pat.keywords && pat.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {pat.keywords.map((kw, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] border border-slate-700">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              </>
            )}
          </div>
              );
            })()}
      </main>

      {/* ============================================================== */}
      {/* MODAL: REGISTRAR NUEVO USUARIO (INCORPORADO DENTRO DE ADMIN)   */}
      {/* ============================================================== */}
      {newUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-white">Registrar Nuevo Usuario</h3>
                <p className={`${settingsDescCls} mt-1`}>Crea un usuario para operar bajo el núcleo unificado de CrediFlux.</p>
              </div>
              <button
                onClick={() => setNewUserModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdminRegisterUser} className="space-y-3 mt-4">
              <div>
                <label className={settingsLabelCls}>Nombre y Apellido *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Roberto Sánchez"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  className={settingsInputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={settingsLabelCls}>Usuario de Acceso *</label>
                  <input
                    type="text"
                    required
                    placeholder="roberto18"
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    className={settingsInputCls}
                  />
                </div>
                <div>
                  <label className={settingsLabelCls}>Clave de Acceso *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contraseña"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    className={`${settingsInputCls} font-mono`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={settingsLabelCls}>Teléfono</label>
                  <input
                    type="text"
                    placeholder="+58 414-1234567"
                    value={newUserForm.phone}
                    onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                    className={settingsInputCls}
                  />
                </div>
                <div>
                  <label className={settingsLabelCls}>Dirección</label>
                  <input
                    type="text"
                    placeholder="Dirección del cliente..."
                    value={newUserForm.address}
                    onChange={(e) => setNewUserForm({ ...newUserForm, address: e.target.value })}
                    className={settingsInputCls}
                  />
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border border-emerald-500/30 space-y-2.5 ${settingsSubcardTheme}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400">Generación de Licencia Automática:</span>
                  <button
                    type="button"
                    onClick={() => handleAdminGenerateLicense(newUserForm.licenseDurationMonths)}
                    className="text-[11px] font-medium text-teal-300 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Generar otra
                  </button>
                </div>
                <input
                  type="text"
                  value={newUserForm.assignedLicenseKey}
                  onChange={(e) => setNewUserForm({ ...newUserForm, assignedLicenseKey: e.target.value })}
                  placeholder="RIC-XXXX-XXXX-XXXX"
                  className={`${settingsInputCls} bg-slate-900 text-emerald-400 font-mono font-semibold text-center tracking-wider`}
                />

                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-medium">Asignar Vigencia Inicial:</span>
                  <select
                    value={newUserForm.licenseDurationMonths}
                    onChange={(e) => {
                      const m = parseInt(e.target.value, 10);
                      handleAdminGenerateLicense(m);
                    }}
                    className="h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                  >
                    <option value={1}>1 Mes</option>
                    <option value={2}>2 Meses</option>
                    <option value={3}>3 Meses</option>
                    <option value={6}>6 Meses</option>
                    <option value={12}>12 Meses (1 Año)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewUserModal(false)}
                  className={settingsSecondaryBtnCls}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={settingsPrimaryBtnCls}
                >
                  Registrar Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADMIN EDITA USUARIO FINAL & SU LICENCIA                 */}
      {/* ============================================================== */}
      {editUserModal.open && editUserModal.user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">
                {editUserModal.passwordOnly ? 'Editar Clave del Administrador' : 'Editar Usuario y Licencia CrediFlux'}
              </h3>
              <button
                onClick={() => setEditUserModal({ open: false, user: null })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const payload = editUserModal.passwordOnly
                  ? {
                      targetUserId: editUserModal.user.id,
                      updateUserAction: 'edit',
                      updatedPassword: fd.get('password')
                    }
                  : {
                      targetUserId: editUserModal.user.id,
                      updateUserAction: 'edit',
                      updatedName: fd.get('name'),
                      updatedPassword: fd.get('password'),
                      updatedLicenseKey: fd.get('licenseKey'),
                      updatedMonths: fd.get('months')
                    };
                try {
                  const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-user-id': currentUser.id
                    },
                    body: JSON.stringify(payload)
                  });
                  const d = await res.json();
                  if (d.success) {
                    notify(editUserModal.passwordOnly ? 'Clave del Administrador actualizada' : 'Usuario y licencia actualizados en CrediFlux');
                    setEditUserModal({ open: false, user: null });
                    fetchAllData();
                  } else {
                    notify(d.error || 'Error al actualizar', 'error');
                  }
                } catch (err) {
                  notify('Error de red', 'error');
                }
              }}
              className="space-y-3 mt-4"
            >
              {editUserModal.passwordOnly ? (
                <div>
                  <label className={settingsLabelCls}>Nueva Clave de Acceso</label>
                  <input
                    type="text"
                    name="password"
                    defaultValue={editUserModal.user.password}
                    required
                    minLength={4}
                    className={`${settingsInputCls} font-mono`}
                  />
                  <p className={`${settingsHelperCls} mt-1`}>Mínimo 4 caracteres. Esta clave también se aplica a los Parámetros Generales.</p>
                </div>
              ) : (
                <>
              <div>
                <label className={settingsLabelCls}>Nombre y Apellido</label>
                <input
                  type="text"
                  name="name"
                  defaultValue={editUserModal.user.name}
                  required
                  className={settingsInputCls}
                />
              </div>

              <div>
                <label className={settingsLabelCls}>Clave de Acceso</label>
                <input
                  type="text"
                  name="password"
                  defaultValue={editUserModal.user.password}
                  required
                  className={`${settingsInputCls} font-mono`}
                />
              </div>

              <div>
                <label className={settingsLabelCls}>Clave de Licencia</label>
                <input
                  type="text"
                  name="licenseKey"
                  defaultValue={editUserModal.user.licenseKey}
                  required
                  className={`${settingsInputCls} font-mono font-semibold text-emerald-400`}
                />
              </div>

              <div>
                <label className={settingsLabelCls}>Extender Vigencia (Meses a sumar desde hoy)</label>
                <select
                  name="months"
                  defaultValue={editUserModal.user.licenseDurationMonths || 1}
                  className={settingsInputCls}
                >
                  <option value={1}>1 Mes</option>
                  <option value={2}>2 Meses</option>
                  <option value={3}>3 Meses</option>
                  <option value={6}>6 Meses</option>
                  <option value={12}>12 Meses (1 Año)</option>
                </select>
              </div>
                </>
              )}

              <div className="pt-2 flex justify-between gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm(`¿Eliminar usuario ${editUserModal.user.username}?`)) {
                      const res = await fetch('/api/settings', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'x-user-id': currentUser.id
                        },
                        body: JSON.stringify({
                          targetUserId: editUserModal.user.id,
                          updateUserAction: 'delete'
                        })
                      });
                      const d = await res.json();
                      if (d.success) {
                        notify('Usuario eliminado');
                        setEditUserModal({ open: false, user: null });
                        fetchAllData();
                      }
                    }
                  }}
                  className={`${settingsDangerBtnCls} px-3`}
                >
                  Eliminar
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditUserModal({ open: false, user: null })}
                    className={settingsSecondaryBtnCls}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={settingsPrimaryBtnCls}
                  >
                    Guardar
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: HISTORIAL DE PAGOS (ABONOS Y CUOTAS REGISTRADAS)       */}
      {/* ============================================================== */}
      {historyModal && (() => {
        const parseDateOnly = (value) => {
          if (!value) return null;
          const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
          const parsed = new Date(value);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        const formatDate = (date) => {
          if (!date) return '—';
          return date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        };

        const loansById = (loans || []).reduce((acc, l) => { acc[l.id] = l; return acc; }, {});
        const fallbackBcv = Number(dolarRates?.oficial) || 0;

        const historyRows = (payments || [])
          .map((p) => {
            const loan = loansById[p.loanId];
            const usd = Number(p.amount) || 0;
            const rate = Number(p.bcvRate) || fallbackBcv;
            const bs = p.amountBs != null ? Number(p.amountBs) : (rate > 0 ? usd * rate : 0);
            const dateObj = parseDateOnly(p.date) || parseDateOnly(p.createdAt);
            const cuotaLabel = p.installmentNumber === 'total' || p.installmentNumber === 'all'
              ? 'Pago total'
              : (p.installmentNumber != null ? `Cuota #${p.installmentNumber}` : 'Abono');
            return { payment: p, loan, dateObj, usd, bs, rate, cuotaLabel };
          })
          .sort((a, b) => {
            const ta = a.dateObj?.getTime() || 0;
            const tb = b.dateObj?.getTime() || 0;
            if (tb !== ta) return tb - ta;
            return String(b.payment.createdAt || '').localeCompare(String(a.payment.createdAt || ''));
          });

        const term = historySearch.trim().toLowerCase();
        const filteredRows = term
          ? historyRows.filter(row =>
              (row.payment.clientName || '').toLowerCase().includes(term)
              || (row.loan?.productName || '').toLowerCase().includes(term)
              || (row.payment.reference || '').toLowerCase().includes(term)
              || (row.payment.method || '').toLowerCase().includes(term)
              || (row.cuotaLabel || '').toLowerCase().includes(term)
            )
          : historyRows;

        const totalUsd = filteredRows.reduce((sum, r) => sum + r.usd, 0);
        const totalBs = filteredRows.reduce((sum, r) => sum + (Number.isFinite(r.bs) ? r.bs : 0), 0);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
              <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-800">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-400" />
                    Historial de Pagos de Financiamientos
                  </h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Registro de abonos y cuotas (incluye pagos parciales y totales). Cada entrada suma al acumulado mostrado.
                  </p>
                </div>
                <button type="button" onClick={() => setHistoryModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white" title="Cerrar historial">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 py-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="relative w-full lg:w-80">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input type="text" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Buscar por cliente, producto, referencia o método..." className="w-full pl-9 pr-8 py-2 bg-slate-800/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                  {historySearch ? (
                    <button type="button" onClick={() => setHistorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white" title="Limpiar búsqueda">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-semibold">{filteredRows.length} de {historyRows.length} pago(s)</span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 font-bold border border-emerald-500/20">Acumulado: ${totalUsd.toFixed(2)} USD</span>
                  <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-300 font-bold border border-sky-500/20">Bs {totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b-2 border-slate-700 bg-slate-800">
                    <tr className="whitespace-nowrap">
                      <th className="w-12 py-3 px-2 text-center align-middle"><span className="block text-xs font-bold text-slate-100">#</span></th>
                      <th className="py-3 px-3 text-left align-middle"><span className="block text-xs font-bold text-slate-100">Fecha</span><span className="mt-0.5 block text-[10px] font-medium text-slate-400">Pago</span></th>
                      <th className="py-3 px-3 text-left align-middle"><span className="block text-xs font-bold text-slate-100">Cliente</span><span className="mt-0.5 block text-[10px] font-medium text-slate-400">Financiamiento</span></th>
                      <th className="py-3 px-3 text-left align-middle"><span className="block text-xs font-bold text-slate-100">Concepto</span><span className="mt-0.5 block text-[10px] font-medium text-slate-400">Cuota / detalle</span></th>
                      <th className="py-3 px-3 text-center align-middle"><span className="block text-xs font-bold text-slate-100">Monto (USD)</span></th>
                      <th className="py-3 px-3 text-center align-middle"><span className="block text-xs font-bold text-slate-100">Monto (Bs)</span><span className="mt-0.5 block text-[10px] font-medium text-slate-400">Tasa BCV del pago</span></th>
                      <th className="py-3 px-3 text-left align-middle"><span className="block text-xs font-bold text-slate-100">Método / Ref.</span></th>
                      <th className="py-3 px-3 text-center align-middle"><span className="block text-xs font-bold text-slate-100">Acción</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredRows.map((row, index) => (
                      <tr key={row.payment.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-2 text-center align-middle text-[11px] font-semibold tabular-nums text-slate-500">{index + 1}</td>
                        <td className="py-2.5 px-3 align-middle whitespace-nowrap">
                          <div className="text-slate-200 font-semibold">{formatDate(row.dateObj)}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{row.payment.id}</div>
                        </td>
                        <td className="py-2.5 px-3 align-middle">
                          <div className="font-bold text-white text-sm leading-tight">{row.payment.clientName || '—'}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{row.loan ? (row.loan.type === 'producto' ? 'Producto' : 'Dinero') : 'Financiamiento'}</div>
                        </td>
                        <td className="py-2.5 px-3 align-middle">
                          <div className="max-w-[220px] truncate text-[11px] font-medium text-slate-300" title={row.loan?.productName || ''}>{row.loan?.productName || '—'}</div>
                          <div className="mt-0.5 text-[10px] text-emerald-400 font-semibold">{row.cuotaLabel}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center align-middle whitespace-nowrap">
                          <span className="font-bold text-emerald-400 tabular-nums">${row.usd.toFixed(2)}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center align-middle whitespace-nowrap">
                          <div className="font-semibold text-slate-200 tabular-nums">Bs {Number.isFinite(row.bs) ? row.bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{row.rate ? `Tasa: ${Number(row.rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : 'Sin tasa registrada'}</div>
                        </td>
                        <td className="py-2.5 px-3 align-middle">
                          <div className="text-slate-300">{row.payment.method || '—'}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500 truncate max-w-[150px]" title={row.payment.reference || ''}>Ref: {row.payment.reference || '—'}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center align-middle">
                          <button type="button" onClick={() => deletePaymentRecord(row.payment)} title="Eliminar pago del historial (revierte la cuota)" className="p-2 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-slate-800 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}

                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-12 px-4 text-center">
                          <div className="text-xs font-semibold text-slate-300">{term ? 'No hay pagos que coincidan con la búsqueda.' : 'Aún no hay pagos registrados en el historial.'}</div>
                          <div className="mt-1 text-[10px] text-slate-500">Cada abono o cuota registrada aparecerá aquí y sumará al acumulado automáticamente. Al eliminar un pago, la cuota asociada vuelve a pendiente.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between gap-3">
                <p className="text-[10px] text-slate-500">Al eliminar un pago, los cuadros estadísticos se recalculan en tiempo real.</p>
                <button type="button" onClick={() => setHistoryModal(false)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs">Cerrar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ============================================================== */}
      {/* MODAL: CONFIRMAR BAJA DE FINANCIAMIENTO (INCUMPLIMIENTO)       */}
      {/* ============================================================== */}
      {deleteLoanModal.open && deleteLoanModal.loan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-800 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Dar de baja financiamiento</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Esta acción es irreversible y se registrará como incumplimiento.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !deleteLoanModal.processing && setDeleteLoanModal({ open: false, loan: null, processing: false })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-40"
                disabled={deleteLoanModal.processing}
                title="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-700/60">
                <p className="text-xs font-semibold text-white">{deleteLoanModal.loan.clientName}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {deleteLoanModal.loan.productName} • ${(Number(deleteLoanModal.loan.totalAmount) || 0).toFixed(2)} total • Saldo pendiente ${(Number(deleteLoanModal.loan.stats?.pendingAmount) || 0).toFixed(2)}
                </p>
              </div>

              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
                <p className="text-[11px] font-bold text-rose-200 mb-2">Consecuencias operativas</p>
                <ul className="space-y-1.5 text-[11px] text-rose-100/90">
                  <li>• El financiamiento se dará de baja por <strong>incumplimiento</strong> y se archivará automáticamente en el <strong>Historial</strong>.</li>
                  <li>• El cliente cambiará su estatus a <strong>Eliminado</strong> y será removido de la tabla activa de clientes y del módulo de financiamientos.</li>
                  <li>• Los datos del cliente se trasladarán de forma persistente a la <strong>Lista Negra</strong>, bloqueando futuros registros con la misma cédula.</li>
                </ul>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end gap-2.5 bg-slate-900/60">
              <button
                type="button"
                onClick={() => setDeleteLoanModal({ open: false, loan: null, processing: false })}
                disabled={deleteLoanModal.processing}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteLoan}
                disabled={deleteLoanModal.processing}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {deleteLoanModal.processing ? 'Procesando...' : 'Confirmar baja e incumplimiento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: LISTA NEGRA (CLIENTES RESTRINGIDOS)                     */}
      {/* ============================================================== */}
      {blacklistModal && (() => {
        const term = blacklistSearch.trim().toLowerCase();
        const rows = (blacklist || []).filter(entry => {
          if (!term) return true;
          return (entry.name || '').toLowerCase().includes(term)
            || (entry.dni || '').toLowerCase().includes(term)
            || (entry.phone || '').toLowerCase().includes(term);
        });

        const formatDate = (value) => {
          if (!value) return '—';
          const d = new Date(value);
          return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
              <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-800">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <Ban className="w-5 h-5 text-rose-400" />
                    Lista Negra de Clientes
                  </h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Usuarios restringidos por incumplimiento. Los registros con cédula coincidente no podrán ser creados nuevamente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBlacklistModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                  title="Cerrar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={blacklistSearch}
                    onChange={(e) => setBlacklistSearch(e.target.value)}
                    placeholder="Buscar por nombre, cédula o teléfono..."
                    className="w-full pl-9 pr-8 py-2 bg-slate-800/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                  />
                  {blacklistSearch ? (
                    <button
                      type="button"
                      onClick={() => setBlacklistSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
                <span className="text-[11px] font-semibold text-slate-400">
                  {rows.length} de {blacklist.length} registro(s)
                </span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b-2 border-slate-700 bg-slate-800">
                    <tr className="whitespace-nowrap">
                      <th className="w-12 py-3 px-2 text-center align-middle">
                        <span className="block text-xs font-bold leading-tight text-slate-100">#</span>
                        <span className="mt-0.5 block text-[10px] font-medium leading-tight text-slate-400">Ítem</span>
                      </th>
                      <th className="py-3 px-3 text-left align-middle">
                        <span className="block text-xs font-bold leading-tight text-slate-100">Cliente</span>
                        <span className="mt-0.5 block text-[10px] font-medium leading-tight text-slate-400">Nombre / Cédula</span>
                      </th>
                      <th className="py-3 px-3 text-left align-middle">
                        <span className="block text-xs font-bold leading-tight text-slate-100">Contacto</span>
                        <span className="mt-0.5 block text-[10px] font-medium leading-tight text-slate-400">Teléfono / Dirección</span>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <span className="block text-xs font-bold leading-tight text-slate-100">Estatus</span>
                        <span className="mt-0.5 block text-[10px] font-medium leading-tight text-slate-400">Motivo</span>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <span className="block text-xs font-bold leading-tight text-slate-100">Fecha de baja</span>
                        <span className="mt-0.5 block text-[10px] font-medium leading-tight text-slate-400">Registro</span>
                      </th>
                      <th className="py-3 px-3 text-center align-middle">
                        <span className="block text-xs font-bold leading-tight text-slate-100">Acciones</span>
                        <span className="mt-0.5 block text-[10px] font-medium leading-tight text-slate-400">Gestión</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {rows.map((entry, index) => {
                      const restoring = restoringBlacklistId === entry.id;
                      return (
                        <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-2 text-center align-middle text-[11px] font-semibold tabular-nums text-slate-500">
                            {index + 1}
                          </td>
                          <td className="py-2.5 px-3 align-middle">
                            <div className="font-bold text-white text-sm leading-tight">{entry.name}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-rose-300">{entry.dni}</div>
                          </td>
                          <td className="py-2.5 px-3 align-middle">
                            <div className="text-slate-300">{entry.phone || 'No registrado'}</div>
                            <div className="mt-0.5 text-[10px] text-slate-500 max-w-[200px] truncate" title={entry.address || ''}>
                              {entry.address || 'Sin dirección registrada'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-rose-500/10 text-rose-400 border-rose-500/30 whitespace-nowrap">
                              Eliminado
                            </span>
                            <div className="mt-1 text-[10px] text-slate-500">{entry.reason || 'Incumplimiento'}</div>
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle whitespace-nowrap">
                            <div className="font-semibold text-slate-200">{formatDate(entry.archivedAt)}</div>
                            <div className="mt-0.5 text-[10px] text-slate-500">{(entry.loanIds || []).length} financiamiento(s)</div>
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            <button
                              type="button"
                              onClick={() => restoreBlacklistedClient(entry)}
                              disabled={restoring}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 font-bold text-[11px] inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
                              title="Reincorporar cliente a la tabla activa"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${restoring ? 'animate-spin' : ''}`} />
                              {restoring ? 'Reincorporando...' : 'Reincorporar'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-12 px-4 text-center">
                          <div className="text-xs font-semibold text-slate-300">
                            {term ? 'No hay registros que coincidan con la búsqueda.' : 'La Lista Negra está vacía.'}
                          </div>
                          <div className="mt-1 text-[10px] text-slate-500">
                            Los clientes dados de baja por incumplimiento aparecerán aquí para control y posible reincorporación.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between gap-3">
                <p className="text-[10px] text-slate-500">
                  Al intentar registrar una cédula existente en esta lista, el sistema mostrará una advertencia y bloqueará la creación.
                </p>
                <button
                  type="button"
                  onClick={() => setBlacklistModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ============================================================== */}
      {/* MODAL: REGISTRAR / EDITAR CLIENTE                              */}
      {/* ============================================================== */}
      {clientModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="font-bold text-base text-white">
                {clientModal.data ? 'Editar Datos de Cliente' : 'Registrar Nuevo Cliente'}
              </h3>
              <button
                onClick={() => setClientModal({ open: false, data: null })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isUserExpired) {
                  notify(SUPPORT_CONTACT_TEXT, 'error');
                  return;
                }
                const fd = new FormData(e.currentTarget);
                const payload = {
                  id: clientModal.data?.id,
                  name: fd.get('name'),
                  dni: fd.get('dni'),
                  phone: fd.get('phone'),
                  address: fd.get('address'),
                  notes: fd.get('notes')
                };

                const res = await fetch('/api/clients', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': currentUser.id
                  },
                  body: JSON.stringify(payload)
                });
                const d = await res.json();
                if (d.licenseExpired) {
                  notify(SUPPORT_CONTACT_TEXT, 'error');
                  return;
                }
                if (d.success) {
                  notify(d.message);
                  setClientModal({ open: false, data: null });
                  fetchAllData();
                } else {
                  notify(d.error || 'Error al guardar', 'error');
                }
              }}
              className="space-y-4 mt-4 text-xs"
            >
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={clientModal.data?.name || ''}
                  placeholder="Ej. Roberto Sánchez"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cédula / DNI *</label>
                  <input
                    type="text"
                    name="dni"
                    required
                    defaultValue={clientModal.data?.dni || ''}
                    placeholder="V-19.123.456"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Teléfono Móvil</label>
                  <input
                    type="text"
                    name="phone"
                    defaultValue={clientModal.data?.phone || ''}
                    placeholder="+58 414-1234567"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Dirección de Habitación / Trabajo</label>
                <input
                  type="text"
                  name="address"
                  defaultValue={clientModal.data?.address || ''}
                  placeholder="Av. Principal, Edificio / Casa..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] leading-relaxed text-emerald-300/90">
                El <strong>nivel de confianza</strong> y el comportamiento de pago se calculan automáticamente a partir del historial de cuotas del cliente. El administrador define los umbrales globales en Ajustes.
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notas / Observaciones</label>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={clientModal.data?.notes || ''}
                  placeholder="Detalles sobre actividad económica o referencias..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setClientModal({ open: false, data: null })}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold"
                >
                  Guardar Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CREAR NUEVO FINANCIAMIENTO                              */}
      {/* ============================================================== */}
      {loanModal.open && (() => {
        const draft = loanModal.data || {
          clientId: '',
          type: 'producto',
          productId: '',
          principal: '',
          downPayment: 0,
          interestRate: 15,
          interestRateUnlocked: false,
          installmentCount: 4,
          frequency: 'quincenal',
          startDate: new Date().toISOString().split('T')[0],
          notes: ''
        };
        const setDraft = (patch) => setLoanModal(prev => ({ ...prev, data: { ...(prev.data || draft), ...patch } }));
        const base = Number(draft.principal) || 0;
        const down = Number(draft.downPayment) || 0;
        const rate = Number(draft.interestRate) || 0;
        const interesMonto = base * (rate / 100);
        const totalAPagar = Math.max(0, (base + interesMonto) - down);
        const selectedProduct = (products || []).find(p => p.id === draft.productId);
        const availableProducts = (products || []).filter(p => (Number(p.stock) || 0) > 0);
        const inputCls = 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
        const labelCls = 'block text-slate-300 font-semibold mb-1 text-[11px]';

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl max-h-[94vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white">Nuevo Financiamiento o Préstamo</h3>
                <p className="text-[11px] text-slate-400">Captura compacta con cálculos automáticos y resumen financiero.</p>
              </div>
              <button type="button" onClick={() => setLoanModal({ open: false, data: null })} className="p-1.5 rounded-lg text-slate-400 hover:text-white" title="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isUserExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                const payload = {
                  clientId: draft.clientId,
                  type: draft.type,
                  productId: draft.type === 'producto' ? (draft.productId || null) : null,
                  principal: Number(draft.principal) || 0,
                  downPayment: Number(draft.downPayment) || 0,
                  interestRate: Number(draft.interestRate) || 0,
                  installmentCount: parseInt(draft.installmentCount, 10) || 1,
                  frequency: draft.frequency || 'quincenal',
                  startDate: draft.startDate || new Date().toISOString().split('T')[0],
                  notes: draft.notes || ''
                };
                if (!payload.clientId) { notify('Selecciona un cliente', 'error'); return; }
                if (payload.type === 'producto' && !payload.productId) { notify('Selecciona un producto del catálogo', 'error'); return; }
                if (!(payload.principal > 0)) { notify('Ingresa un monto base válido', 'error'); return; }

                const res = await fetch('/api/loans', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
                  body: JSON.stringify(payload)
                });
                const d = await res.json();
                if (d.licenseExpired) { notify(SUPPORT_CONTACT_TEXT, 'error'); return; }
                if (d.success) {
                  notify(d.message);
                  setLoanModal({ open: false, data: null });
                  fetchAllData();
                } else {
                  notify(d.error || 'Error al crear financiamiento', 'error');
                }
              }}
              className="mt-4 space-y-3"
            >
              {/* Sección 1: Datos principales */}
              <section className="rounded-2xl border border-slate-800 bg-slate-800/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">1. Datos principales</h4>
                  <span className="text-[10px] text-slate-500">Cliente y producto</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Cliente *</label>
                    <select
                      value={draft.clientId || ''}
                      onChange={(e) => setDraft({ clientId: e.target.value })}
                      required
                      className={inputCls}
                    >
                      <option value="">-- Elige un cliente --</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.dni})</option>
                      ))}
                    </select>
                  </div>
                  <div className={draft.type === 'producto' ? 'grid grid-cols-2 gap-2' : ''}>
                    <div>
                      <label className={labelCls}>Modalidad</label>
                      <select
                        value={draft.type || 'producto'}
                        onChange={(e) => {
                          const nextType = e.target.value;
                          if (nextType === 'dinero') {
                            setDraft({ type: nextType, productId: '', interestRateUnlocked: false });
                          } else {
                            setDraft({ type: nextType });
                          }
                        }}
                        className={inputCls}
                      >
                        <option value="producto">Equipo / producto</option>
                        <option value="dinero">Dinero / efectivo</option>
                      </select>
                    </div>
                    {draft.type === 'producto' && (
                      <div>
                        <label className={labelCls}>Producto *</label>
                        <select
                          value={draft.productId || ''}
                          onChange={(e) => {
                            const pid = e.target.value;
                            const prod = (products || []).find(p => p.id === pid);
                            if (prod) {
                              const margin = Number(prod.profitMarginPercent);
                              const autoRate = Number.isFinite(margin) ? margin : 0;
                              setDraft({
                                productId: pid,
                                // Monto base = costo registrado del producto (bloqueado para financiamientos de inventario)
                                principal: Number(prod.costPrice) || 0,
                                // Porcentaje de ganancia preconfigurado del producto
                                interestRate: Number(Number(autoRate).toFixed(2)),
                                interestRateUnlocked: false
                              });
                            } else {
                              setDraft({ productId: '', principal: '', interestRate: 15, interestRateUnlocked: false });
                            }
                          }}
                          className={inputCls}
                        >
                          <option value="">-- Seleccionar --</option>
                          {availableProducts.map(p => (
                            <option key={p.id} value={p.id}>{p.name} — ${Number(p.salePrice || 0).toFixed(2)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
                {draft.type === 'producto' && selectedProduct && (
                  <p className="mt-1.5 text-[10px] text-emerald-400/90">Monto base (costo) y % de ganancia cargados automáticamente desde el catálogo.</p>
                )}
              </section>

              {/* Sección 2: Cálculos y montos */}
              <section className="rounded-2xl border border-slate-800 bg-slate-800/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">2. Cálculos y montos</h4>
                  <span className="text-[10px] text-slate-500">Base, ganancia e inicial</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Monto Base / Precio ($) *</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={draft.principal === '' ? '' : draft.principal}
                      onChange={(e) => setDraft({ principal: e.target.value === '' ? '' : Number(e.target.value) })}
                      required
                      readOnly={draft.type === 'producto' && Boolean(draft.productId)}
                      title={draft.type === 'producto' && draft.productId ? 'El monto base se toma del costo del producto y no es editable' : undefined}
                      className={`${inputCls} font-bold ${draft.type === 'producto' && draft.productId ? 'opacity-70 cursor-not-allowed bg-slate-800/70' : ''}`}
                      placeholder="Ej. 700"
                    />
                    {draft.type === 'producto' && draft.productId && (
                      <p className="mt-1 text-[10px] text-slate-500">Bloqueado: usa el costo registrado del producto.</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>% Ganancia / Interés</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={draft.interestRate === '' ? '' : draft.interestRate}
                        onChange={(e) => setDraft({ interestRate: e.target.value === '' ? '' : Number(e.target.value) })}
                        disabled={draft.type === 'producto' && draft.productId && !draft.interestRateUnlocked}
                        className={`${inputCls} font-bold text-emerald-400 ${draft.type === 'producto' && draft.productId && !draft.interestRateUnlocked ? 'opacity-70 cursor-not-allowed' : ''}`}
                      />
                      {draft.type === 'producto' && draft.productId ? (
                        <label className="shrink-0 inline-flex items-center gap-1 text-[10px] text-slate-300" title="Editar porcentaje excepcionalmente">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.interestRateUnlocked)}
                            onChange={(e) => setDraft({ interestRateUnlocked: e.target.checked })}
                            className="accent-emerald-500"
                          />
                          Editar
                        </label>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Inicial / Enganche ($)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={draft.downPayment ?? 0}
                      onChange={(e) => setDraft({ downPayment: e.target.value === '' ? 0 : Number(e.target.value) })}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
                  <span>Intereses: <span className="text-teal-400 font-semibold">${interesMonto.toFixed(2)}</span></span>
                  <span>Base a financiar: <span className="text-slate-200 font-semibold">${Math.max(0, base - down).toFixed(2)}</span></span>
                </div>
              </section>

              {/* Condiciones + Resumen */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-3">
                <section className="rounded-2xl border border-slate-800 bg-slate-800/20 p-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Condiciones de pago</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>Cuotas</label>
                      <input
                        type="number"
                        min={1}
                        max={36}
                        value={draft.installmentCount ?? 4}
                        onChange={(e) => setDraft({ installmentCount: e.target.value })}
                        className={`${inputCls} font-bold`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Frecuencia</label>
                      <select
                        value={draft.frequency || 'quincenal'}
                        onChange={(e) => setDraft({ frequency: e.target.value })}
                        className={inputCls}
                      >
                        <option value="semanal">Semanal</option>
                        <option value="quincenal">Quincenal</option>
                        <option value="mensual">Mensual</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Inicio</label>
                      <input
                        type="date"
                        value={draft.startDate || new Date().toISOString().split('T')[0]}
                        onChange={(e) => setDraft({ startDate: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className={labelCls}>Notas / condiciones</label>
                    <input
                      type="text"
                      value={draft.notes || ''}
                      onChange={(e) => setDraft({ notes: e.target.value })}
                      placeholder="Garantías, serie, observaciones..."
                      className={inputCls}
                    />
                  </div>
                </section>

                {/* Sección 3: Resumen financiero */}
                <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 flex flex-col justify-between">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80 mb-2">3. Resumen financiero</h4>
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between text-slate-300"><span>Monto base</span><span className="font-semibold tabular-nums">${base.toFixed(2)}</span></div>
                      <div className="flex items-center justify-between text-slate-300"><span>+ Intereses ({rate || 0}%)</span><span className="font-semibold text-teal-400 tabular-nums">${interesMonto.toFixed(2)}</span></div>
                      <div className="flex items-center justify-between text-slate-300"><span>− Inicial</span><span className="font-semibold text-amber-400 tabular-nums">${down.toFixed(2)}</span></div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-emerald-500/20">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Total a pagar</p>
                    <p className="mt-0.5 text-2xl font-extrabold text-white tabular-nums leading-none">${totalAPagar.toFixed(2)}</p>
                    <p className="mt-1 text-[10px] text-slate-400">(Monto Base + Intereses/Porcentaje de Ganancia) − Inicial</p>
                  </div>
                </section>
              </div>

              <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-[10px] text-slate-500">Obligatorios: cliente, monto base y producto (si aplica).</p>
                <div className="flex items-center gap-2 justify-end">
                  <button type="button" onClick={() => setLoanModal({ open: false, data: null })} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs">Cancelar</button>
                  <button type="submit" className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs">Generar Contrato</button>
                </div>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* MODAL: ABONO RÁPIDO / PAGO DE CUOTA                            */}
      {/* ============================================================== */}
      {quickPayModal.open && quickPayModal.loan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white">Registrar Abono o Cuota</h3>
                <p className="text-xs text-slate-400">Cliente: {quickPayModal.loan.clientName}</p>
              </div>
              <button
                onClick={() => { setQuickPayModal({ open: false, loan: null }); setQuickPaySelection(''); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterPayment} className="space-y-4 mt-4 text-xs">
              {(() => {
                const loan = quickPayModal.loan;
                const unpaidInstallments = (loan.installments || []).filter(i => !i.paid);
                const pendingTotal = Number(unpaidInstallments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toFixed(2));
                const selectedIsTotal = quickPaySelection === 'all';
                const selectedInstallment = unpaidInstallments.find(i => String(i.number) === String(quickPaySelection));
                const amountValue = selectedIsTotal
                  ? pendingTotal.toFixed(2)
                  : (Number(selectedInstallment?.amount ?? loan.installmentAmount ?? 0)).toFixed(2);

                return (
                  <>
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">Cuota a Cancelar</label>
                      <select
                        name="installmentNumber"
                        value={quickPaySelection || (unpaidInstallments[0] ? String(unpaidInstallments[0].number) : 'all')}
                        onChange={(e) => setQuickPaySelection(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                      >
                        <option value="all">Pago Total (saldar financiamiento) — ${pendingTotal.toFixed(2)}</option>
                        {unpaidInstallments.map(inst => (
                          <option key={inst.number} value={inst.number}>
                            Cuota #{inst.number} - ${Number(inst.amount).toFixed(2)} (Vence: {inst.dueDate})
                          </option>
                        ))}
                      </select>
                      {selectedIsTotal && (
                        <p className="mt-1.5 text-[10px] text-amber-300/90">
                          Se liquidarán {unpaidInstallments.length} cuota(s) pendiente(s) en una sola transacción.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">Monto del Pago ($)</label>
                      <input
                        type="number"
                        step="any"
                        name="amount"
                        key={`amount-${quickPaySelection}-${amountValue}`}
                        defaultValue={amountValue}
                        required
                        readOnly={selectedIsTotal}
                        className={`w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white font-bold text-emerald-400 ${selectedIsTotal ? 'opacity-90 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Método de Pago</label>
                        <select
                          name="method"
                          defaultValue="Pago Móvil"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                        >
                          <option value="Pago Móvil">Pago Móvil</option>
                          <option value="Zelle">Zelle</option>
                          <option value="Efectivo USD">Efectivo USD</option>
                          <option value="Transferencia">Transferencia Bancaria</option>
                          <option value="Binance USDT">Binance USDT</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Nº Referencia</label>
                        <input
                          type="text"
                          name="reference"
                          placeholder="Ej. REF-881920"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                        />
                      </div>
                    </div>
                  </>
                );
              })()}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setQuickPayModal({ open: false, loan: null }); setQuickPaySelection(''); }}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold"
                >
                  Confirmar Cobro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: REGISTRAR / EDITAR PRODUCTO DEL CATÁLOGO               */}
      {/* ============================================================== */}
      {productModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="font-bold text-base text-white">
                {productModal.data ? 'Editar Producto' : 'Registro de producto'}
              </h3>
              <button
                onClick={() => setProductModal({ open: false, data: null })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isUserExpired) {
                  notify(SUPPORT_CONTACT_TEXT, 'error');
                  return;
                }
                const fd = new FormData(e.currentTarget);
                const payload = {
                  id: productModal.data?.id,
                  name: fd.get('name'),
                  costPrice: fd.get('costPrice'),
                  stock: fd.get('stock')
                };

                const res = await fetch('/api/products', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': currentUser.id
                  },
                  body: JSON.stringify(payload)
                });
                const d = await res.json();
                if (d.licenseExpired) {
                  notify(SUPPORT_CONTACT_TEXT, 'error');
                  return;
                }
                if (d.success) {
                  notify(d.message);
                  setProductModal({ open: false, data: null });
                  fetchAllData();
                } else {
                  notify(d.error || 'Error al guardar producto', 'error');
                }
              }}
              className="space-y-4 mt-4 text-xs"
            >
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre / Modelo del Equipo *</label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={productModal.data?.name || ''}
                  placeholder="Ej. iPhone 15 Pro 128GB"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Costo Adquisición ($) *</label>
                <input
                  type="number"
                  step="any"
                  name="costPrice"
                  required
                  defaultValue={productModal.data?.costPrice || ''}
                  placeholder="650"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white font-bold"
                />
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <p className="text-[11px] text-emerald-300/90 leading-relaxed">
                  El <span className="font-semibold">margen de ganancia</span> y el{' '}
                  <span className="font-semibold">precio de venta financiado</span> se gestionan directamente en la tabla de productos.
                  El margen inicia en 30% por defecto.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Cantidad en Inventario (Stock)</label>
                <input
                  type="number"
                  name="stock"
                  defaultValue={productModal.data?.stock || 1}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductModal({ open: false, data: null })}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold"
                >
                  Guardar Equipo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CARGAR PATRÓN DE COMPROBANTE (ADMIN)                    */}
      {/* ============================================================== */}
      {patternModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-white">Cargar Patrón de Comprobante Oficial</h3>
                <p className={`${settingsDescCls} mt-1`}>
                  Registra un modelo de comprobante y banco emisor para validación cruzada precisa del OCR.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPatternModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReceiptPattern} className="space-y-4 mt-4">
              <div>
                <label className={settingsLabelCls}>
                  Banco Emisor Oficial *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Banesco, Banco de Venezuela, Mercantil, BBVA Provincial..."
                  value={patternForm.bankName}
                  onChange={(e) => setPatternForm({ ...patternForm, bankName: e.target.value })}
                  className={`${settingsInputCls} font-medium`}
                />
              </div>

              <div>
                <label className={settingsLabelCls}>
                  Imagen de Comprobante Patrón (Capture Modelo)
                </label>
                <div
                  onClick={() => patternFileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center cursor-pointer transition-colors bg-slate-800/30 hover:bg-slate-800/50"
                >
                  <input
                    type="file"
                    ref={patternFileInputRef}
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setPatternForm(prev => ({
                          ...prev,
                          file,
                          filePreview: URL.createObjectURL(file)
                        }));
                      }
                    }}
                    className="hidden"
                  />
                  {patternForm.filePreview ? (
                    <div className="space-y-2">
                      <img
                        src={patternForm.filePreview}
                        alt="Preview Patrón"
                        className="max-h-36 mx-auto rounded-xl object-contain border border-slate-700"
                      />
                      <p className="text-xs text-emerald-400 font-semibold truncate">
                        {patternForm.file?.name}
                      </p>
                      <span className="text-[11px] text-slate-400">Click para sustituir imagen patrón</span>
                    </div>
                  ) : (
                    <div className="py-3">
                      <Upload className="w-7 h-7 text-emerald-400 mx-auto mb-1.5 opacity-80" />
                      <p className="text-xs font-semibold text-slate-300">
                        Subir captura o comprobante de referencia
                      </p>
                      <p className={`${settingsHelperCls} mt-1`}>Muestra oficial del banco</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={settingsLabelCls}>
                    Formato de Referencia
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 8 a 12 dígitos"
                    value={patternForm.referenceFormat}
                    onChange={(e) => setPatternForm({ ...patternForm, referenceFormat: e.target.value })}
                    className={settingsInputCls}
                  />
                </div>
                <div>
                  <label className={settingsLabelCls}>
                    Palabras Clave (Separadas por coma)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. banesco, pagomovil, bdv"
                    value={patternForm.keywords}
                    onChange={(e) => setPatternForm({ ...patternForm, keywords: e.target.value })}
                    className={settingsInputCls}
                  />
                </div>
              </div>

              <div>
                <label className={settingsLabelCls}>
                  Notas de Identificación Visual
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej. Franja verde superior con logotipo en blanco, texto de confirmación 'Transferencia Exitosa'"
                  value={patternForm.notes}
                  onChange={(e) => setPatternForm({ ...patternForm, notes: e.target.value })}
                  className={settingsTextareaCls}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPatternModal(false)}
                  className={`${settingsSecondaryBtnCls} flex-1`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={patternForm.processing}
                  className={`${settingsPrimaryBtnCls} flex-1`}
                >
                  {patternForm.processing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Guardar Patrón</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: VACIAR DATOS (ADMIN, GRANULAR Y POR FECHA)             */}
      {/* ============================================================== */}
      {purgeModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-white">Vaciar datos del sistema</h3>
                <p className={`${settingsDescCls} mt-1`}>
                  Usuario seleccionado: <span className="text-slate-200 font-semibold">{purgeModal.user?.name || purgeModal.user?.username || '—'}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => !purgeModal.processing && setPurgeModal(prev => ({ ...prev, open: false }))}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-40"
                disabled={purgeModal.processing}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mt-4">
              <div className={`rounded-xl border p-3 ${settingsSubcardTheme}`}>
                <p className="text-xs font-semibold text-slate-200 mb-2">Datos a limpiar (granular)</p>
                <label className="flex items-center gap-2 text-xs font-semibold text-emerald-300 mb-2 pb-2 border-b border-slate-700/60 cursor-pointer">
                  <input
                    ref={selectAllPurgeRef}
                    type="checkbox"
                    checked={allPurgeTargetsSelected}
                    disabled={purgeModal.processing}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setPurgeModal(prev => ({
                        ...prev,
                        targets: Object.fromEntries(PURGE_TARGET_KEYS.map((key) => [key, checked]))
                      }));
                    }}
                    className="accent-emerald-500"
                  />
                  Seleccionar todos
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PURGE_TARGET_OPTIONS.map(([key, label]) => (
                    <label key={key} className="flex items-start gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(purgeModal.targets?.[key])}
                        disabled={purgeModal.processing}
                        onChange={(e) => setPurgeModal(prev => ({
                          ...prev,
                          targets: { ...prev.targets, [key]: e.target.checked }
                        }))}
                        className="mt-0.5 accent-emerald-500"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <p className={`${settingsHelperCls} mt-2`}>Nota: la limpieza se aplica únicamente a los datos del usuario seleccionado y a los registros que coincidan con el filtro de fecha indicado.</p>
              </div>

              <div className={`rounded-xl border p-3 ${settingsSubcardTheme}`}>
                <p className="text-xs font-semibold text-slate-200 mb-2">Filtro de borrado por fecha</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={purgeModal.filter?.period || 'all'}
                    onChange={(e) => setPurgeModal(prev => ({ ...prev, filter: { ...prev.filter, period: e.target.value } }))}
                    className="h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                  >
                    <option value="all">Todo (sin filtro)</option>
                    <option value="day">Día</option>
                    <option value="month">Mes</option>
                    <option value="year">Año</option>
                    <option value="until">Hasta una fecha en concreto</option>
                  </select>
                  {purgeModal.filter?.period === 'day' && (
                    <input type="date" value={purgeModal.filter.day || ''} onChange={(e) => setPurgeModal(prev => ({ ...prev, filter: { ...prev.filter, day: e.target.value } }))} className="h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                  )}
                  {purgeModal.filter?.period === 'month' && (
                    <input type="month" value={purgeModal.filter.month || ''} onChange={(e) => setPurgeModal(prev => ({ ...prev, filter: { ...prev.filter, month: e.target.value } }))} className="h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                  )}
                  {purgeModal.filter?.period === 'year' && (
                    <input type="number" min="2000" max="2100" step="1" value={purgeModal.filter.year || ''} onChange={(e) => setPurgeModal(prev => ({ ...prev, filter: { ...prev.filter, year: e.target.value } }))} className="h-10 w-24 px-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" placeholder="Año" />
                  )}
                  {purgeModal.filter?.period === 'until' && (
                    <input type="date" value={purgeModal.filter.until || ''} onChange={(e) => setPurgeModal(prev => ({ ...prev, filter: { ...prev.filter, until: e.target.value } }))} className="h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPurgeModal(prev => ({ ...prev, open: false }))}
                  disabled={purgeModal.processing}
                  className={settingsSecondaryBtnCls}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={purgeModal.processing || !somePurgeTargetsSelected}
                  onClick={async () => {
                    const targets = purgeModal.targets || {};
                    if (!somePurgeTargetsSelected) {
                      notify('Selecciona al menos un tipo de dato para vaciar', 'error');
                      return;
                    }
                    if (!confirm('¿Confirmas vaciar los datos seleccionados con el filtro indicado? Esta acción no se puede deshacer.')) return;
                    setPurgeModal(prev => ({ ...prev, processing: true }));
                    try {
                      const res = await fetch('/api/admin/purge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
                        body: JSON.stringify({ userId: purgeModal.user?.id, target_user_id: purgeModal.user?.id, targets, filter: purgeModal.filter })
                      });
                      const d = await res.json();
                      if (d.licenseExpired) {
                        notify(SUPPORT_CONTACT_TEXT, 'error');
                      } else if (d.success) {
                        const s = d.summary || {};
                        notify(`Datos vaciados: pagos ${s.payments || 0}, financiamientos ${s.loans || 0}, clientes ${s.clients || 0}, productos ${s.products || 0}, e-commerce ${s.ecommerce || 0}, capital ${s.capital || 0}`);
                        setPurgeModal(prev => ({ ...prev, open: false, processing: false }));
                        fetchAllData();
                      } else {
                        notify(d.error || 'Error al vaciar datos', 'error');
                      }
                    } catch (err) {
                      notify('Error de red al vaciar datos', 'error');
                    } finally {
                      setPurgeModal(prev => ({ ...prev, processing: false }));
                    }
                  }}
                  className="h-10 px-4 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-lg text-sm transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {purgeModal.processing ? 'Vaciando...' : 'Vaciar datos seleccionados'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: HISTORIAL / RÉCORD CREDITICIO DEL CLIENTE              */}
      {/* ============================================================== */}
      {viewHistoryClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white">Récord Crediticio e Historial</h3>
                <p className="text-xs text-slate-400">
                  {viewHistoryClient.name} • {viewHistoryClient.dni} • Confianza: <strong>{viewHistoryClient.trust?.label || computeClientTrust((loans || []).filter(l => l.clientId === viewHistoryClient.id), getTrustLevelConfig(settings)).label}</strong>
                </p>
              </div>
              <button
                onClick={() => setViewHistoryClient(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {viewHistoryClient.creditHistory?.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  Este cliente no posee financiamientos registrados aún.
                </div>
              ) : (
                viewHistoryClient.creditHistory.map((h, i) => (
                  <div key={i} className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800 flex items-center justify-between">
                    <div>
                      <h5 className="font-bold text-white text-sm">{h.productName}</h5>
                      <p className="text-slate-400 text-xs">
                        Inicio: {h.startDate} • Cuotas: {h.paidCount}/{h.installmentsCount}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-extrabold text-emerald-400">${h.totalAmount}</div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${h.status === 'moroso' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                        {h.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
