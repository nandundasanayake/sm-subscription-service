"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchAdminApplications,
  createAdminApplication,
  updateAdminApplication,
  deleteAdminApplication,
  fetchAdminPackages,
  fetchAdminSubscriptions,
  updateAdminSubscriptionStatus,
  createAdminPackage,
  updateAdminPackage,
  deleteAdminPackage,
  AdminApplication,
  AdminPackage,
  AdminSubscription,
  PhotographerLimits,
} from "@/lib/api";
import { clearAdminToken, getAdminToken, isTokenValid } from "@/lib/auth";
import Toast from "@/components/Toast";
import {
  ShieldCheck,
  Package,
  CreditCard,
  RefreshCw,
  Search,
  ArrowLeft,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Filter,
  Check,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
  Globe,
  LogOut,
  Infinity as InfinityIcon,
  Camera,
} from "lucide-react";

const formatDate = (dateString?: string | null) => {
  if (!dateString) return "-";
  const utcString =
    dateString.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateString)
      ? dateString
      : `${dateString}Z`;

  const date = new Date(utcString);
  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

// ── Photographer Limits form helpers ──────────────────────────────────────────
// UI-only shape: each of the 4 limits is independently toggled on/off
// ("enabled"), and while on is either "Unlimited" or backed by a concrete
// number. Converted to the {number|null} shape the API expects on submit
// (disabled and enabled-but-unlimited both submit as null — the backend has
// no separate "enabled" concept, only a value or null), and derived back
// from it when editing an existing package.
type LimitFieldState = { enabled: boolean; unlimited: boolean; value: string };

type PhotographerLimitsForm = {
  max_events: LimitFieldState;
  storage_limit_gb: LimitFieldState;
  max_photos_per_event: LimitFieldState;
  event_link_expiry_days: LimitFieldState;
};

const DISABLED_LIMIT_FIELD: LimitFieldState = { enabled: false, unlimited: true, value: "" };

const DEFAULT_LIMITS_FORM: PhotographerLimitsForm = {
  max_events: { ...DISABLED_LIMIT_FIELD },
  storage_limit_gb: { ...DISABLED_LIMIT_FIELD },
  max_photos_per_event: { ...DISABLED_LIMIT_FIELD },
  event_link_expiry_days: { ...DISABLED_LIMIT_FIELD },
};

// null/-1 (backend also accepts -1, but we always emit null) is what both
// "not enforced" and "enforced as Unlimited" persist as, so there's no way
// to tell those two apart on load — we default to "not enforced" (off),
// the more common case, and the admin can flip it on and leave "Unlimited"
// checked if they specifically want that bullet auto-generated.
const limitFieldFromValue = (value: number | null | undefined): LimitFieldState =>
  value === null || value === undefined || value < 0
    ? { ...DISABLED_LIMIT_FIELD }
    : { enabled: true, unlimited: false, value: String(value) };

const limitsFormFromPackage = (limits?: { photographer_limits?: Partial<PhotographerLimits> } | null): PhotographerLimitsForm => {
  const pl = limits?.photographer_limits;
  return {
    max_events: limitFieldFromValue(pl?.max_events),
    storage_limit_gb: limitFieldFromValue(pl?.storage_limit_gb),
    max_photos_per_event: limitFieldFromValue(pl?.max_photos_per_event),
    event_link_expiry_days: limitFieldFromValue(pl?.event_link_expiry_days),
  };
};

type PhotographerLimitKey = keyof PhotographerLimitsForm;

const PHOTOGRAPHER_LIMIT_FIELDS: {
  key: PhotographerLimitKey;
  label: string;
  unit: string;
  placeholder: string;
}[] = [
  { key: "max_events", label: "Max Events", unit: "events", placeholder: "e.g. 3" },
  { key: "storage_limit_gb", label: "Storage Limit", unit: "GB", placeholder: "e.g. 5" },
  { key: "max_photos_per_event", label: "Max Photos per Event", unit: "photos", placeholder: "e.g. 100" },
  { key: "event_link_expiry_days", label: "Event Link Expiry", unit: "days", placeholder: "e.g. 7" },
];

// Each limit maps to a human-readable feature bullet. Kept as (value|null) ->
// string so both the auto-generator and the strip-on-edit pattern derive
// from the same wording — one place to change copy.
const describeLimit = (
  key: PhotographerLimitKey,
  unlimited: boolean,
  value: string
): string | null => {
  if (unlimited) {
    return {
      max_events: "Unlimited events",
      storage_limit_gb: "Unlimited storage",
      max_photos_per_event: "Unlimited photos per event",
      event_link_expiry_days: "Event links never expire",
    }[key];
  }
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) return null;
  return {
    max_events: `Up to ${n} event${n === 1 ? "" : "s"}`,
    storage_limit_gb: `${n}GB storage limit`,
    max_photos_per_event: `${n} photo${n === 1 ? "" : "s"} per event`,
    event_link_expiry_days: `Event links expire after ${n} day${n === 1 ? "" : "s"}`,
  }[key];
};

// Matches anything describeLimit() could ever produce, for any key or
// number, regardless of current field state — used to strip previously
// auto-generated bullets out of a package's saved `features` list so they
// aren't duplicated as "manual" text when re-opening the edit form.
const AUTO_FEATURE_PATTERNS: RegExp[] = [
  /^unlimited events$/i,
  /^up to \d+ events?$/i,
  /^unlimited storage$/i,
  /^\d+gb storage limit$/i,
  /^unlimited photos per event$/i,
  /^\d+ photos? per event$/i,
  /^event links never expire$/i,
  /^event links expire after \d+ days?$/i,
];

const stripAutoGeneratedFeatures = (features?: string[] | null): string[] =>
  (features || []).filter((f) => !AUTO_FEATURE_PATTERNS.some((re) => re.test(f.trim())));

const buildAutoFeatures = (limits: PhotographerLimitsForm): string[] => {
  return PHOTOGRAPHER_LIMIT_FIELDS.map(({ key }) => {
    const field = limits[key];
    return field.enabled ? describeLimit(key, field.unlimited, field.value) : null;
  }).filter((f): f is string => f !== null);
};

// Disabled, or enabled-and-Unlimited, both submit as null to the API.
const resolveLimitValue = (field: LimitFieldState): number | null =>
  field.enabled && !field.unlimited ? parseInt(field.value, 10) : null;

function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
  ariaLabel,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2.5 cursor-pointer select-none">
      {label && <span className="text-xs font-bold text-ink">{label}</span>}
      <span className="relative inline-block w-9 h-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label ? undefined : ariaLabel}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-border peer-checked:bg-accent-dark transition-colors" />
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function LimitFieldRow({
  id,
  label,
  unit,
  placeholder,
  field,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  placeholder: string;
  field: LimitFieldState;
  onChange: (next: LimitFieldState) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-chalk/20 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-xs font-semibold text-ink">{label}</span>
        <ToggleSwitch
          id={id}
          checked={field.enabled}
          ariaLabel={`Enforce ${label}`}
          onChange={(enabled) =>
            onChange(enabled ? { ...field, enabled: true } : { ...DISABLED_LIMIT_FIELD })
          }
        />
      </div>

      {field.enabled ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {field.unlimited ? (
              <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-dashed border-border bg-chalk/30 text-xs text-dim italic">
                <InfinityIcon className="w-3.5 h-3.5 text-accent-dark shrink-0" />
                Unlimited
              </div>
            ) : (
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={field.value}
                  onChange={(e) => onChange({ ...field, value: e.target.value })}
                  className="w-full pl-3.5 pr-16 py-2 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors font-mono"
                  placeholder={placeholder}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-dim uppercase pointer-events-none">
                  {unit}
                </span>
              </div>
            )}
          </div>

          <label className="flex flex-col items-center gap-1 shrink-0 cursor-pointer select-none">
            <span className="text-[10px] font-semibold text-dim uppercase tracking-wide">Unlimited</span>
            <input
              type="checkbox"
              checked={field.unlimited}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { ...field, unlimited: true, value: "" }
                    : { ...field, unlimited: false }
                )
              }
              className="w-4 h-4 rounded border-border text-accent-dark focus:ring-accent cursor-pointer"
            />
          </label>
        </div>
      ) : (
        <p className="text-[11px] text-dim italic px-3.5 py-2 rounded-xl border border-dashed border-border bg-chalk/10">
          Not enforced — unlimited by default.
        </p>
      )}
    </div>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 10;

function Pagination({
  page,
  total,
  size,
  onPageChange,
  itemLabel,
}: {
  page: number;
  total: number;
  size: number;
  onPageChange: (page: number) => void;
  itemLabel: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="text-[11px] text-dim">
        {total === 0 ? `No ${itemLabel}` : `Showing ${from}–${to} of ${total} ${itemLabel}`}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-lg border border-border bg-chalk hover:bg-border/30 text-[11px] font-semibold text-dim hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Previous
        </button>
        <span className="text-[11px] font-semibold text-ink px-2 whitespace-nowrap">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-lg border border-border bg-chalk hover:bg-border/30 text-[11px] font-semibold text-dim hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// One page of a resource, scoped to a single app_id.
interface AppScopedPage<T> {
  items: T[];
  total: number;
  page: number;
  loading: boolean;
}

const EMPTY_APP_PAGE = { items: [], total: 0, page: 1, loading: false };

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [applications, setApplications] = useState<AdminApplication[]>([]);
  const [applicationsTotal, setApplicationsTotal] = useState(0);
  const [applicationsPage, setApplicationsPage] = useState(1);

  // Packages/subscriptions are fetched per-app, paginated — each accordion
  // owns its own page of each, keyed by app_id.
  const [packagesByApp, setPackagesByApp] = useState<Record<string, AppScopedPage<AdminPackage>>>({});
  const [subscriptionsByApp, setSubscriptionsByApp] = useState<Record<string, AppScopedPage<AdminSubscription>>>({});

  // Cheap page=1&size=1 fetches purely to read `.total` for the metric cards
  // below, without pulling every row across every app into memory.
  const [packagesTotal, setPackagesTotal] = useState(0);
  const [subscriptionsTotal, setSubscriptionsTotal] = useState(0);
  const [activeSubsTotal, setActiveSubsTotal] = useState(0);
  const [pendingSubsTotal, setPendingSubsTotal] = useState(0);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({});
  const [activeAppTabs, setActiveAppTabs] = useState<Record<string, "subscriptions" | "packages">>({});

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Application Modal State (Register New App / Edit App)
  const [isAppModalOpen, setIsAppModalOpen] = useState(false);
  const [appModalMode, setAppModalMode] = useState<"create" | "edit">("create");
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [submittingApp, setSubmittingApp] = useState(false);
  const [appFormData, setAppFormData] = useState({
    app_id: "",
    name: "",
    description: "",
  });

  // Application Delete Confirmation State
  const [deletingApplication, setDeletingApplication] = useState<AdminApplication | null>(null);
  const [isDeletingApplication, setIsDeletingApplication] = useState(false);

  // Package Modal State (Create / Edit)
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [lockedAppId, setLockedAppId] = useState<boolean>(false);
  const [submittingPackage, setSubmittingPackage] = useState(false);
  const [packageFormData, setPackageFormData] = useState({
    app_id: "scanme",
    name: "",
    price: "",
    billing_cycle: "monthly",
    features: "",
  });
  const [limitsFormData, setLimitsFormData] = useState<PhotographerLimitsForm>(DEFAULT_LIMITS_FORM);

  const updateLimitField = (key: PhotographerLimitKey, next: LimitFieldState) => {
    setLimitsFormData((prev) => ({ ...prev, [key]: next }));
  };

  // Derived, not stored: recomputes from the limit fields on every change so
  // it can never drift out of sync with what's actually about to be saved.
  // Only individually-enabled limits contribute a bullet here.
  const autoFeatures = useMemo(() => buildAutoFeatures(limitsFormData), [limitsFormData]);

  // Package Delete Confirmation State
  const [deletingPackage, setDeletingPackage] = useState<AdminPackage | null>(null);
  const [isDeletingPackage, setIsDeletingPackage] = useState(false);

  // The registered applications ARE the list of accordions now — packages
  // and subscriptions are fetched per app_id on demand (see loadPackagesForApp
  // / loadSubscriptionsForApp below), so there's no need to scan them here.
  const uniqueAppIds = Array.from(new Set(applications.map((a) => a.app_id)));

  const toggleAppAccordion = (appId: string) => {
    setExpandedApps((prev) => ({
      ...prev,
      [appId]: !(prev[appId] ?? true),
    }));
  };

  const toggleAllAccordions = (expand: boolean) => {
    const newState: Record<string, boolean> = {};
    uniqueAppIds.forEach((appId) => {
      newState[appId] = expand;
    });
    setExpandedApps(newState);
  };

  const openRegisterAppModal = () => {
    setAppModalMode("create");
    setEditingApplicationId(null);
    setAppFormData({ app_id: "", name: "", description: "" });
    setIsAppModalOpen(true);
  };

  const openEditAppModal = (app: AdminApplication) => {
    setAppModalMode("edit");
    setEditingApplicationId(app.id);
    setAppFormData({
      app_id: app.app_id,
      name: app.name,
      description: app.description || "",
    });
    setIsAppModalOpen(true);
  };

  const openCreateModal = (defaultAppId?: string) => {
    setModalMode("create");
    setEditingPackageId(null);
    const targetAppId = defaultAppId || (uniqueAppIds[0] ?? "scanme");
    setPackageFormData({
      app_id: targetAppId,
      name: "",
      price: "",
      billing_cycle: "monthly",
      features: "",
    });
    setLimitsFormData(DEFAULT_LIMITS_FORM);
    setLockedAppId(!!defaultAppId);
    setIsPackageModalOpen(true);
  };

  const openEditModal = (pkg: AdminPackage) => {
    setModalMode("edit");
    setEditingPackageId(pkg.id);
    setLockedAppId(false);
    setPackageFormData({
      app_id: pkg.app_id || "scanme",
      name: pkg.name,
      price: pkg.price.toString(),
      billing_cycle: pkg.billing_cycle || "monthly",
      features: stripAutoGeneratedFeatures(pkg.features).join(", "),
    });
    setLimitsFormData(limitsFormFromPackage(pkg.limits));
    setIsPackageModalOpen(true);
  };

  const handleAppFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appFormData.app_id.trim() || !appFormData.name.trim()) {
      setToast({ message: "Please fill in all required fields.", type: "error" });
      return;
    }

    setSubmittingApp(true);
    try {
      const payload = {
        app_id: appFormData.app_id.trim().toLowerCase(),
        name: appFormData.name.trim(),
        description: appFormData.description.trim() || undefined,
      };

      if (appModalMode === "create") {
        await createAdminApplication(payload);
        setToast({
          message: `🎉 Application "${appFormData.name}" registered successfully!`,
          type: "success",
        });
      } else if (appModalMode === "edit" && editingApplicationId) {
        await updateAdminApplication(editingApplicationId, payload);
        setToast({
          message: `✨ Application "${appFormData.name}" updated successfully!`,
          type: "success",
        });
      }

      setIsAppModalOpen(false);
      setEditingApplicationId(null);
      setAppFormData({ app_id: "", name: "", description: "" });
      await loadData(true, true);
    } catch (err: any) {
      console.error(`Failed to ${appModalMode} application`, err);
      const detail = err?.message || `Failed to ${appModalMode === "create" ? "register" : "update"} application. Please try again.`;
      setToast({ message: detail, type: "error" });
    } finally {
      setSubmittingApp(false);
    }
  };

  const handlePackageFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packageFormData.name.trim() || !packageFormData.price) {
      setToast({ message: "Please fill in all required fields.", type: "error" });
      return;
    }

    // Every enabled, non-unlimited limit needs a concrete non-negative
    // integer. Disabled limits are skipped entirely — their inputs are
    // hidden and they always submit as null.
    for (const { key, label } of PHOTOGRAPHER_LIMIT_FIELDS) {
      const field = limitsFormData[key];
      if (!field.enabled || field.unlimited) continue;
      const parsed = Number(field.value);
      if (field.value.trim() === "" || !Number.isInteger(parsed) || parsed < 0) {
        setToast({
          message: `"${label}" needs a whole number of 0 or more, or check "Unlimited".`,
          type: "error",
        });
        return;
      }
    }

    setSubmittingPackage(true);
    try {
      const manualFeatures = packageFormData.features
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      // Auto-generated bullets first, then whatever the admin typed by hand;
      // de-duped in case a manual entry happens to match one word-for-word.
      const combinedFeatures = Array.from(new Set([...autoFeatures, ...manualFeatures]));

      const photographerLimits: PhotographerLimits = {
        max_events: resolveLimitValue(limitsFormData.max_events),
        storage_limit_gb: resolveLimitValue(limitsFormData.storage_limit_gb),
        max_photos_per_event: resolveLimitValue(limitsFormData.max_photos_per_event),
        event_link_expiry_days: resolveLimitValue(limitsFormData.event_link_expiry_days),
      };

      const payload = {
        app_id: packageFormData.app_id.trim() || "scanme",
        name: packageFormData.name.trim(),
        price: parseFloat(packageFormData.price),
        billing_cycle: packageFormData.billing_cycle,
        features: combinedFeatures.length > 0 ? combinedFeatures : undefined,
        limits: { photographer_limits: photographerLimits },
      };

      if (modalMode === "create") {
        await createAdminPackage(payload);
        setToast({
          message: `🎉 Package "${packageFormData.name}" created successfully for ${packageFormData.app_id}!`,
          type: "success",
        });
      } else if (modalMode === "edit" && editingPackageId) {
        await updateAdminPackage(editingPackageId, payload);
        setToast({
          message: `✨ Package "${packageFormData.name}" updated successfully!`,
          type: "success",
        });
      }

      setIsPackageModalOpen(false);
      setEditingPackageId(null);
      await loadData(true, true);
    } catch (err: any) {
      console.error("Failed to save package", err);
      const detail = err?.message || "Failed to save package. Please try again.";
      setToast({ message: detail, type: "error" });
    } finally {
      setSubmittingPackage(false);
    }
  };

  const handleConfirmDeletePackage = async () => {
    if (!deletingPackage) return;
    setIsDeletingPackage(true);
    try {
      await deleteAdminPackage(deletingPackage.id);
      setToast({
        message: `🗑️ Package "${deletingPackage.name}" deleted successfully!`,
        type: "success",
      });
      setDeletingPackage(null);
      await loadData(true, true);
    } catch (err: any) {
      console.error("Failed to delete package", err);
      const detail = err?.message || "Failed to delete package. Please try again.";
      setToast({ message: detail, type: "error" });
    } finally {
      setIsDeletingPackage(false);
    }
  };

  const handleConfirmDeleteApplication = async () => {
    if (!deletingApplication) return;
    setIsDeletingApplication(true);
    try {
      await deleteAdminApplication(deletingApplication.id);
      setToast({
        message: `🗑️ Application "${deletingApplication.name}" deleted successfully!`,
        type: "success",
      });
      setDeletingApplication(null);
      await loadData(true, true);
    } catch (err: any) {
      console.error("Failed to delete application", err);
      const detail = err?.message || "Failed to delete application. Please try again.";
      setToast({ message: detail, type: "error" });
    } finally {
      setIsDeletingApplication(false);
    }
  };

  const loadApplicationsPage = async (page: number): Promise<AdminApplication[]> => {
    const res = await fetchAdminApplications({ page, size: PAGE_SIZE });
    setApplications(res.items);
    setApplicationsTotal(res.total);
    setApplicationsPage(res.page);
    // Whenever the set of visible apps changes (including paging through
    // "Registered Platforms" itself), preload page 1 of each one's
    // packages/subscriptions so their accordions aren't empty on expand.
    await Promise.all(
      res.items.flatMap((a) => [loadPackagesForApp(a.app_id, 1), loadSubscriptionsForApp(a.app_id, 1)])
    );
    return res.items;
  };

  const loadPackagesForApp = async (appId: string, page: number) => {
    setPackagesByApp((prev) => ({
      ...prev,
      [appId]: { ...(prev[appId] ?? EMPTY_APP_PAGE), loading: true },
    }));
    try {
      const res = await fetchAdminPackages({ appId, page, size: PAGE_SIZE });
      setPackagesByApp((prev) => ({
        ...prev,
        [appId]: { items: res.items, total: res.total, page: res.page, loading: false },
      }));
    } catch (err: any) {
      setPackagesByApp((prev) => ({
        ...prev,
        [appId]: { ...(prev[appId] ?? EMPTY_APP_PAGE), loading: false },
      }));
      setToast({ message: err?.message || `Failed to load packages for "${appId}".`, type: "error" });
    }
  };

  const loadSubscriptionsForApp = async (appId: string, page: number, statusOverride?: string) => {
    setSubscriptionsByApp((prev) => ({
      ...prev,
      [appId]: { ...(prev[appId] ?? EMPTY_APP_PAGE), loading: true },
    }));
    // statusOverride lets the Status dropdown's onChange pass the new value
    // directly — reading `statusFilter` from closure there would still see
    // the pre-update value until the next render.
    const effectiveStatus = statusOverride ?? statusFilter;
    try {
      const res = await fetchAdminSubscriptions({
        appId,
        page,
        size: PAGE_SIZE,
        status: effectiveStatus === "ALL" ? undefined : effectiveStatus.toLowerCase(),
      });
      setSubscriptionsByApp((prev) => ({
        ...prev,
        [appId]: { items: res.items, total: res.total, page: res.page, loading: false },
      }));
    } catch (err: any) {
      setSubscriptionsByApp((prev) => ({
        ...prev,
        [appId]: { ...(prev[appId] ?? EMPTY_APP_PAGE), loading: false },
      }));
      setToast({ message: err?.message || `Failed to load subscriptions for "${appId}".`, type: "error" });
    }
  };

  // Cheap page=1&size=1 requests solely to read `.total` — keeps the metric
  // cards accurate without pulling every subscription/package into memory.
  const refreshMetricTotals = async () => {
    const [pkgCount, subCount, activeCount, pendingCount] = await Promise.all([
      fetchAdminPackages({ page: 1, size: 1 }),
      fetchAdminSubscriptions({ page: 1, size: 1 }),
      fetchAdminSubscriptions({ page: 1, size: 1, status: "active" }),
      fetchAdminSubscriptions({ page: 1, size: 1, status: "pending" }),
    ]);
    setPackagesTotal(pkgCount.total);
    setSubscriptionsTotal(subCount.total);
    setActiveSubsTotal(activeCount.total);
    setPendingSubsTotal(pendingCount.total);
  };

  // resetToFirstPage: after creating/editing/deleting something, jump back to
  // page 1 of applications (a newly-created app sorts first) — a manual
  // "Refresh" click instead preserves whatever page of applications you were
  // on. Every app's packages/subscriptions always reload at page 1 either
  // way, which keeps this simple and matches how most admin panels behave
  // after a mutation.
  const loadData = async (isManualRefresh = false, resetToFirstPage = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setToast(null);

    try {
      await Promise.all([
        loadApplicationsPage(resetToFirstPage ? 1 : applicationsPage || 1),
        refreshMetricTotals(),
      ]);
      if (isManualRefresh) {
        setToast({ message: "Data refreshed successfully!", type: "info" });
      }
    } catch (err: any) {
      console.error("Failed to load admin subscription data", err);
      setToast({
        message: err?.message || "Failed to fetch admin data from subscription service.",
        type: "error",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Redirect to /login if there's no admin token, or it's expired/malformed.
  // This is a UX guard only — the backend independently rejects unauthorized
  // requests on every call regardless of what this check decides.
  useEffect(() => {
    const token = getAdminToken();
    if (!isTokenValid(token)) {
      clearAdminToken();
      router.replace("/login");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  useEffect(() => {
    if (authChecked) loadData();
  }, [authChecked]);

  const handleLogout = () => {
    clearAdminToken();
    router.replace("/login");
  };

  const handleStatusChange = async (appId: string, subscriptionId: string, newStatus: string) => {
    setUpdatingId(subscriptionId);
    try {
      const updated = await updateAdminSubscriptionStatus(subscriptionId, newStatus);
      setSubscriptionsByApp((prev) => {
        const bucket = prev[appId];
        if (!bucket) return prev;
        return {
          ...prev,
          [appId]: {
            ...bucket,
            items: bucket.items.map((s) => (s.id === subscriptionId ? { ...s, status: updated.status } : s)),
          },
        };
      });
      setToast({
        message: `Subscription status updated to "${newStatus.toUpperCase()}"`,
        type: "success",
      });
      // The active/pending counts on the metric cards may have just shifted.
      refreshMetricTotals().catch(() => {});
    } catch (err: any) {
      console.error("Status update failed", err);
      const detail = err?.message || "Failed to update subscription status.";
      setToast({ message: detail, type: "error" });
    } finally {
      setUpdatingId(null);
    }
  };

  // Metrics — sourced from the lightweight count-only fetches in
  // refreshMetricTotals(), not from whatever partial data happens to be
  // loaded into packagesByApp/subscriptionsByApp at the moment.
  const totalSubs = subscriptionsTotal;
  const activeSubs = activeSubsTotal;
  const pendingSubs = pendingSubsTotal;
  const totalPkgs = packagesTotal;

  const renderStatusBadge = (status: string) => {
    const st = status.toLowerCase();
    switch (st) {
      case "active":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-success/15 text-success border border-success/30">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            ACTIVE
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 border border-amber-500/30">
            <Clock className="w-3 h-3" />
            PENDING
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-danger/15 text-danger border border-danger/30">
            <XCircle className="w-3 h-3" />
            CANCELLED
          </span>
        );
      case "expired":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-dim/15 text-dim border border-dim/30">
            <AlertCircle className="w-3 h-3" />
            EXPIRED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-dim/10 text-dim">
            {status.toUpperCase()}
          </span>
        );
    }
  };

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-chalk flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-ink border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-chalk font-body text-ink pb-24">
      {/* ── Top Sticky Navbar ──────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-surface/95 backdrop-blur-md border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between gap-4">
          {/* Left: Back button + Title & Admin Badge */}
          <div className="flex items-center gap-4">
            <a
              href="/photographer-dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-chalk hover:bg-border/40 text-dim hover:text-ink text-xs font-semibold transition-all group"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              <span>Back</span>
            </a>

            <div className="h-6 w-px bg-border hidden sm:block" />

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-ink text-chalk text-[11px] font-extrabold tracking-wider uppercase shadow-xs shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                ADMIN
              </span>
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight text-ink leading-tight">
                  Application Subscriptions & Packages
                </h1>
              </div>
            </div>
          </div>

          {/* Right: Register New App + Refresh Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={openRegisterAppModal}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-accent text-ink hover:bg-accent-dark hover:text-white transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Register New App</span>
            </button>

            <button
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-ink text-chalk hover:bg-ink/80 active:scale-95 disabled:opacity-50 transition-all cursor-pointer shadow-sm shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={handleLogout}
              title="Log out"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-border bg-chalk hover:bg-danger/10 hover:border-danger/30 hover:text-danger text-dim transition-all cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
        {/* ── Metric Cards ────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
          <div className="bg-surface p-5 rounded-2xl border border-border shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-dark shrink-0">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-dim">
                Registered Platforms
              </p>
              <p className="font-display text-2xl font-bold mt-0.5">{applicationsTotal}</p>
            </div>
          </div>

          <div className="bg-surface p-5 rounded-2xl border border-border shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-ink/5 border border-border flex items-center justify-center text-ink shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-dim">
                Total Subscriptions
              </p>
              <p className="font-display text-2xl font-bold mt-0.5">{totalSubs}</p>
            </div>
          </div>

          <div className="bg-surface p-5 rounded-2xl border border-border shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center text-success shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-dim">
                Active Subscriptions
              </p>
              <p className="font-display text-2xl font-bold text-success mt-0.5">
                {activeSubs}
              </p>
            </div>
          </div>

          <div className="bg-surface p-5 rounded-2xl border border-border shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-dim">
                Package Catalog
              </p>
              <p className="font-display text-2xl font-bold text-amber-600 mt-0.5">
                {totalPkgs}
              </p>
            </div>
          </div>
        </div>

        {/* ── Search & Global Toolbar ─────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-surface p-4 rounded-2xl border border-border shadow-xs">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
            <input
              type="text"
              placeholder="Search across apps by User ID, Subscription ID, or Package..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-border bg-chalk/50 focus:bg-surface focus:outline-none focus:border-ink transition-colors"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-dim" />
              <span className="text-xs text-dim font-medium">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  const value = e.target.value;
                  setStatusFilter(value);
                  // Re-fetch page 1 of every visible app's subscriptions
                  // under the new server-side status filter. Pass `value`
                  // explicitly — `statusFilter` state won't reflect it until
                  // the next render.
                  applications.forEach((a) => loadSubscriptionsForApp(a.app_id, 1, value));
                }}
                className="text-xs font-semibold px-3 py-2 rounded-xl border border-border bg-surface text-ink focus:outline-none focus:border-ink cursor-pointer"
              >
                <option value="ALL">All Statuses ({subscriptionsTotal})</option>
                <option value="ACTIVE">Active ({activeSubs})</option>
                <option value="PENDING">Pending ({pendingSubs})</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="EXPIRED">Expired</option>
              </select>
            </div>

            <div className="h-5 w-px bg-border hidden sm:block" />

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => toggleAllAccordions(true)}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-chalk hover:bg-border/30 text-[11px] font-semibold text-dim hover:text-ink transition-colors cursor-pointer"
              >
                Expand All
              </button>
              <button
                onClick={() => toggleAllAccordions(false)}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-chalk hover:bg-border/30 text-[11px] font-semibold text-dim hover:text-ink transition-colors cursor-pointer"
              >
                Collapse All
              </button>
            </div>
          </div>
        </div>

        {/* ── App-Centric Accordions List ─────────────────────── */}
        {loading ? (
          <div className="bg-surface rounded-2xl border border-border p-16 text-center text-dim space-y-3">
            <div className="w-8 h-8 border-3 border-ink border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-medium">Loading multi-tenant application data...</p>
          </div>
        ) : applicationsTotal === 0 ? (
          <div className="bg-surface rounded-2xl border border-border p-16 text-center text-dim space-y-3">
            <Globe className="w-10 h-10 mx-auto text-dim/50" />
            <p className="text-base font-semibold text-ink">No Applications Registered</p>
            <p className="text-xs">Register your first tenant application platform using the top button.</p>
            <button
              onClick={openRegisterAppModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-accent text-ink hover:bg-accent-dark hover:text-white transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Register New Application</span>
            </button>
          </div>
        ) : uniqueAppIds.length === 0 ? (
          // Total > 0 but this page came back empty (e.g. the last item on
          // the last page was just deleted) — nudge back to page 1 instead
          // of showing a dead end.
          <div className="bg-surface rounded-2xl border border-border p-16 text-center text-dim space-y-3">
            <Globe className="w-10 h-10 mx-auto text-dim/50" />
            <p className="text-base font-semibold text-ink">No applications on this page</p>
            <button
              onClick={() => loadApplicationsPage(1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-accent text-ink hover:bg-accent-dark hover:text-white transition-all shadow-xs cursor-pointer"
            >
              Back to page 1
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {uniqueAppIds.map((appId) => {
              const isExpanded = expandedApps[appId] ?? true;
              const activeSubTab = activeAppTabs[appId] || "subscriptions";

              // Application Metadata lookup
              const appRecord = applications.find((a) => a.app_id === appId);
              const appTitle = appRecord?.name || appId;
              const appDesc = appRecord?.description;

              // App-specific packages & subscriptions — one paginated page
              // each, fetched on demand (see loadPackagesForApp /
              // loadSubscriptionsForApp). Search below only filters within
              // whatever page is currently loaded, not across the full set.
              const packagesPageState = packagesByApp[appId] ?? EMPTY_APP_PAGE;
              const subscriptionsPageState = subscriptionsByApp[appId] ?? EMPTY_APP_PAGE;
              const appPackages = packagesPageState.items;
              const appSubscriptionsAll = subscriptionsPageState.items;

              const appActiveCount = appSubscriptionsAll.filter(
                (s) => s.status.toLowerCase() === "active"
              ).length;
              const appPendingCount = appSubscriptionsAll.filter(
                (s) => s.status.toLowerCase() === "pending"
              ).length;

              // Filtered subscriptions for this app (within the loaded page only)
              const appSubscriptionsFiltered = appSubscriptionsAll.filter((sub) => {
                const matchesSearch =
                  sub.user_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  sub.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  (sub.package?.name || "").toLowerCase().includes(searchTerm.toLowerCase());

                const matchesStatus =
                  statusFilter === "ALL" ||
                  sub.status.toUpperCase() === statusFilter.toUpperCase();

                return matchesSearch && matchesStatus;
              });

              // Filtered packages for this app (within the loaded page only)
              const appPackagesFiltered = appPackages.filter((pkg) => {
                return (
                  pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  pkg.id.toLowerCase().includes(searchTerm.toLowerCase())
                );
              });

              return (
                <div
                  key={appId}
                  className="bg-surface rounded-2xl border border-border shadow-xs overflow-hidden transition-all"
                >
                  {/* ── Accordion Header Row ──────────────────── */}
                  <div
                    onClick={() => toggleAppAccordion(appId)}
                    className="w-full px-6 py-4 flex flex-wrap items-center justify-between gap-4 bg-chalk/40 hover:bg-chalk/80 transition-colors cursor-pointer border-b border-border/60"
                  >
                    {/* Left: App ID Badge & Name */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-ink text-chalk flex items-center justify-center font-mono font-extrabold text-sm shadow-xs shrink-0">
                        <Globe className="w-5 h-5 text-accent" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-display text-base font-bold text-ink leading-tight">
                            {appTitle}
                          </h2>
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold font-mono bg-accent/20 text-accent-dark border border-accent/30">
                            {appId}
                          </span>
                        </div>
                        <p className="text-xs text-dim mt-0.5">
                          {appDesc || `${subscriptionsPageState.total} total subscriptions • ${packagesPageState.total} packages`}
                        </p>
                      </div>
                    </div>

                    {/* Middle: Summary Stats */}
                    <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-surface border border-border text-ink">
                        <Users className="w-3.5 h-3.5 text-dim" />
                        <span>{subscriptionsPageState.total} Subscriptions</span>
                      </span>

                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-success/10 border border-success/20 text-success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{appActiveCount} Active</span>
                      </span>

                      {appPendingCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-600">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{appPendingCount} Pending</span>
                        </span>
                      )}

                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-accent/10 border border-accent/20 text-accent-dark">
                        <Package className="w-3.5 h-3.5" />
                        <span>{packagesPageState.total} Packages</span>
                      </span>
                    </div>

                    {/* Right: App actions, Add Package & Expand Toggle */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (appRecord) openEditAppModal(appRecord);
                        }}
                        disabled={!appRecord}
                        className="p-2 rounded-xl border border-border bg-surface hover:bg-chalk hover:border-ink text-dim hover:text-ink transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title={appRecord ? `Edit ${appTitle}` : "No matching Application record"}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (appRecord) setDeletingApplication(appRecord);
                        }}
                        disabled={!appRecord}
                        className="p-2 rounded-xl border border-danger/20 bg-danger/5 hover:bg-danger hover:text-white text-danger transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title={appRecord ? `Delete ${appTitle}` : "No matching Application record"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-6 bg-border mx-1" />

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCreateModal(appId);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface hover:bg-ink hover:text-chalk border border-border text-ink transition-all cursor-pointer shadow-2xs"
                        title={`Add Package for ${appId}`}
                      >
                        <Plus className="w-3.5 h-3.5 text-accent-dark" />
                        <span>Add Package</span>
                      </button>

                      <div className="w-8 h-8 rounded-xl bg-chalk border border-border flex items-center justify-center text-dim transition-transform">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Accordion Body (Expanded Content) ─────── */}
                  {isExpanded && (
                    <div className="p-6 space-y-6 bg-surface">
                      {/* App Inner Tabs */}
                      <div className="flex items-center justify-between border-b border-border pb-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              setActiveAppTabs((prev) => ({ ...prev, [appId]: "subscriptions" }))
                            }
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                              activeSubTab === "subscriptions"
                                ? "bg-ink text-chalk shadow-xs"
                                : "bg-chalk border border-border text-dim hover:text-ink"
                            }`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            Subscriptions ({appSubscriptionsFiltered.length})
                          </button>

                          <button
                            onClick={() =>
                              setActiveAppTabs((prev) => ({ ...prev, [appId]: "packages" }))
                            }
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                              activeSubTab === "packages"
                                ? "bg-ink text-chalk shadow-xs"
                                : "bg-chalk border border-border text-dim hover:text-ink"
                            }`}
                          >
                            <Package className="w-3.5 h-3.5" />
                            Packages ({appPackagesFiltered.length})
                          </button>
                        </div>

                        <p className="text-xs text-dim font-medium hidden sm:block">
                          Platform Tenant ID: <span className="font-mono font-bold text-ink">{appId}</span>
                        </p>
                      </div>

                      {/* ── Sub-Tab 1: Subscriptions for App ───── */}
                      {activeSubTab === "subscriptions" && (
                        <div>
                          {appSubscriptionsFiltered.length === 0 ? (
                            <div className="p-10 text-center text-dim bg-chalk/30 rounded-2xl border border-dashed border-border space-y-2">
                              <AlertCircle className="w-7 h-7 mx-auto text-dim/50" />
                              <p className="text-xs font-semibold text-ink">
                                No subscriptions found for application "{appId}"
                              </p>
                              <p className="text-[11px]">
                                {searchTerm || statusFilter !== "ALL"
                                  ? "Try adjusting your search or status filter."
                                  : `No active subscriptions have been created for ${appId} yet.`}
                              </p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border border-border shadow-2xs">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="bg-chalk/80 border-b border-border uppercase tracking-wider font-semibold text-dim">
                                    <th className="py-3 px-4">User ID</th>
                                    <th className="py-3 px-4">Package</th>
                                    <th className="py-3 px-4">Status</th>
                                    <th className="py-3 px-4">Created At</th>
                                    <th className="py-3 px-4 text-right">Actions (Set Status)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {appSubscriptionsFiltered.map((sub) => {
                                    const isUpdating = updatingId === sub.id;

                                    return (
                                      <tr
                                        key={sub.id}
                                        className="hover:bg-chalk/40 transition-colors"
                                      >
                                        {/* User ID */}
                                        <td className="py-3.5 px-4">
                                          <div className="flex items-center gap-2.5">
                                            <div className="w-7 h-7 rounded-full bg-ink/5 border border-border flex items-center justify-center text-ink text-[11px] font-bold shrink-0">
                                              {sub.user_id.slice(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                              <p className="font-mono text-xs font-semibold text-ink">
                                                {sub.user_id}
                                              </p>
                                              <p className="text-[10px] text-dim font-mono">
                                                ID: {sub.id.slice(0, 8)}...
                                              </p>
                                            </div>
                                          </div>
                                        </td>

                                        {/* Package */}
                                        <td className="py-3.5 px-4">
                                          <div>
                                            <span className="inline-flex items-center gap-1 font-semibold text-ink">
                                              <Sparkles className="w-3 h-3 text-accent-dark" />
                                              {sub.package?.name || "Standard Plan"}
                                            </span>
                                            {sub.package && (
                                              <p className="text-[11px] text-dim">
                                                ${sub.package.price.toFixed(2)} / {sub.package.billing_cycle}
                                              </p>
                                            )}
                                          </div>
                                        </td>

                                        {/* Status */}
                                        <td className="py-3.5 px-4">
                                          {renderStatusBadge(sub.status)}
                                        </td>

                                        {/* Created At */}
                                        <td className="py-3.5 px-4 text-dim">
                                          {formatDate(sub.created_at)}
                                        </td>

                                        {/* Actions */}
                                        <td className="py-3.5 px-4 text-right">
                                          <div className="inline-flex items-center justify-end gap-1.5">
                                            {isUpdating ? (
                                              <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                                                <span className="w-3 h-3 border-2 border-ink border-t-transparent rounded-full animate-spin" />
                                                Updating...
                                              </span>
                                            ) : (
                                              <>
                                                <button
                                                  onClick={() => handleStatusChange(appId, sub.id, "active")}
                                                  disabled={sub.status.toLowerCase() === "active"}
                                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                                                    sub.status.toLowerCase() === "active"
                                                      ? "opacity-30 cursor-not-allowed bg-border text-dim"
                                                      : "bg-success/15 text-success hover:bg-success hover:text-white border border-success/30"
                                                  }`}
                                                  title="Set Active"
                                                >
                                                  Set Active
                                                </button>

                                                <button
                                                  onClick={() => handleStatusChange(appId, sub.id, "pending")}
                                                  disabled={sub.status.toLowerCase() === "pending"}
                                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                                                    sub.status.toLowerCase() === "pending"
                                                      ? "opacity-30 cursor-not-allowed bg-border text-dim"
                                                      : "bg-amber-500/15 text-amber-700 hover:bg-amber-500 hover:text-white border border-amber-500/30"
                                                  }`}
                                                  title="Set Pending"
                                                >
                                                  Pending
                                                </button>

                                                <button
                                                  onClick={() => handleStatusChange(appId, sub.id, "cancelled")}
                                                  disabled={sub.status.toLowerCase() === "cancelled"}
                                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                                                    sub.status.toLowerCase() === "cancelled"
                                                      ? "opacity-30 cursor-not-allowed bg-border text-dim"
                                                      : "bg-danger/15 text-danger hover:bg-danger hover:text-white border border-danger/30"
                                                  }`}
                                                  title="Cancel Subscription"
                                                >
                                                  Cancel
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {subscriptionsPageState.total > 0 && (
                            <Pagination
                              page={subscriptionsPageState.page}
                              total={subscriptionsPageState.total}
                              size={PAGE_SIZE}
                              onPageChange={(p) => loadSubscriptionsForApp(appId, p)}
                              itemLabel="subscriptions"
                            />
                          )}
                        </div>
                      )}

                      {/* ── Sub-Tab 2: Packages for App ────────── */}
                      {activeSubTab === "packages" && (
                        <div>
                          {appPackagesFiltered.length === 0 ? (
                            <div className="p-10 text-center text-dim bg-chalk/30 rounded-2xl border border-dashed border-border space-y-3">
                              <Package className="w-7 h-7 mx-auto text-dim/50" />
                              <p className="text-xs font-semibold text-ink">
                                No packages defined for application "{appId}"
                              </p>
                              <button
                                onClick={() => openCreateModal(appId)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-accent text-ink hover:bg-accent-dark hover:text-white transition-all cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Create Package for {appId}</span>
                              </button>
                            </div>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border border-border shadow-2xs">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="bg-chalk/80 border-b border-border uppercase tracking-wider font-semibold text-dim">
                                    <th className="py-3 px-4">Package Name</th>
                                    <th className="py-3 px-4">Price</th>
                                    <th className="py-3 px-4">Billing Cycle</th>
                                    <th className="py-3 px-4">Features Included</th>
                                    <th className="py-3 px-4">Package ID</th>
                                    <th className="py-3 px-4 text-right">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {appPackagesFiltered.map((pkg) => (
                                    <tr key={pkg.id} className="hover:bg-chalk/40 transition-colors">
                                      {/* Name */}
                                      <td className="py-3.5 px-4 font-semibold text-ink flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 text-accent-dark flex items-center justify-center shrink-0">
                                          <Package className="w-3.5 h-3.5" />
                                        </div>
                                        {pkg.name}
                                      </td>

                                      {/* Price */}
                                      <td className="py-3.5 px-4 font-display font-bold text-ink">
                                        ${pkg.price.toFixed(2)}
                                      </td>

                                      {/* Billing Cycle */}
                                      <td className="py-3.5 px-4">
                                        <span className="capitalize text-[11px] font-medium px-2 py-0.5 rounded-full bg-ink/5 border border-border text-ink">
                                          {pkg.billing_cycle}
                                        </span>
                                      </td>

                                      {/* Features */}
                                      <td className="py-3.5 px-4">
                                        <div className="flex flex-wrap gap-1 max-w-xs">
                                          {pkg.features && pkg.features.length > 0 ? (
                                            pkg.features.map((f, i) => (
                                              <span
                                                key={i}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] bg-chalk border border-border text-dim"
                                              >
                                                <Check className="w-2.5 h-2.5 text-success shrink-0" />
                                                {f}
                                              </span>
                                            ))
                                          ) : (
                                            <span className="text-[11px] text-dim italic">
                                              Standard features
                                            </span>
                                          )}
                                        </div>
                                      </td>

                                      {/* ID */}
                                      <td className="py-3.5 px-4 font-mono text-[11px] text-dim">
                                        {pkg.id}
                                      </td>

                                      {/* Actions */}
                                      <td className="py-3.5 px-4 text-right">
                                        <div className="inline-flex items-center justify-end gap-1.5">
                                          <button
                                            onClick={() => openEditModal(pkg)}
                                            className="p-1.5 rounded-lg border border-border bg-surface hover:bg-chalk hover:border-ink text-dim hover:text-ink transition-colors cursor-pointer"
                                            title="Edit Package"
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => setDeletingPackage(pkg)}
                                            className="p-1.5 rounded-lg border border-danger/20 bg-danger/5 hover:bg-danger hover:text-white text-danger transition-colors cursor-pointer"
                                            title="Delete Package"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {packagesPageState.total > 0 && (
                            <Pagination
                              page={packagesPageState.page}
                              total={packagesPageState.total}
                              size={PAGE_SIZE}
                              onPageChange={(p) => loadPackagesForApp(appId, p)}
                              itemLabel="packages"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && applicationsTotal > 0 && (
          <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs">
            <Pagination
              page={applicationsPage}
              total={applicationsTotal}
              size={PAGE_SIZE}
              onPageChange={(p) => loadApplicationsPage(p)}
              itemLabel="registered platforms"
            />
          </div>
        )}
      </div>

      {/* ── Register / Edit Application Modal ─────────────────── */}
      {isAppModalOpen && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-chalk/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent-dark flex items-center justify-center font-bold">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    {appModalMode === "create" ? "Register New Application" : "Edit Application"}
                  </h3>
                  <p className="text-[11px] text-dim">
                    {appModalMode === "create"
                      ? "Add a new platform/tenant to the multi-application registry"
                      : "Update this platform's details"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAppModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-ink hover:bg-border/40 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleAppFormSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Application ID (app_id) <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={appFormData.app_id}
                  onChange={(e) =>
                    setAppFormData((prev) => ({ ...prev, app_id: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors font-mono"
                  placeholder="e.g. event_app, scanme, ticket_hub"
                />
                <p className="text-[11px] text-dim mt-1">
                  Unique identifier used by frontends and microservices to target this tenant.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Application Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={appFormData.name}
                  onChange={(e) =>
                    setAppFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors"
                  placeholder="e.g. Event Photography Portal"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Description <span className="text-dim font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={appFormData.description}
                  onChange={(e) =>
                    setAppFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors resize-none"
                  placeholder="Brief summary of what this platform does..."
                />
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAppModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-border bg-chalk hover:bg-border/30 text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingApp}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-ink text-chalk hover:bg-ink/80 disabled:opacity-50 transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  {submittingApp ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-chalk border-t-transparent rounded-full animate-spin" />
                      <span>{appModalMode === "create" ? "Registering..." : "Saving..."}</span>
                    </>
                  ) : appModalMode === "create" ? (
                    <>
                      <Plus className="w-4 h-4 text-accent" />
                      <span>Register Application</span>
                    </>
                  ) : (
                    <>
                      <Pencil className="w-4 h-4 text-accent" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Create / Edit Package Modal ─────────────────────── */}
      {isPackageModalOpen && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-chalk/40 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent-dark flex items-center justify-center font-bold">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    {modalMode === "create" ? "Create New Package" : "Edit Package"}
                  </h3>
                  <p className="text-[11px] text-dim">
                    {modalMode === "create"
                      ? `Add a pricing plan for application "${packageFormData.app_id}"`
                      : "Modify existing package pricing or features"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPackageModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-ink hover:bg-border/40 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handlePackageFormSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  App ID <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  readOnly={modalMode === "create" && lockedAppId}
                  value={packageFormData.app_id}
                  onChange={(e) =>
                    setPackageFormData((prev) => ({ ...prev, app_id: e.target.value }))
                  }
                  className={`w-full px-3.5 py-2.5 text-sm rounded-xl border border-border transition-colors font-mono ${
                    modalMode === "create" && lockedAppId
                      ? "bg-chalk/80 text-dim cursor-not-allowed border-border/80"
                      : "bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink"
                  }`}
                  placeholder="e.g. scanme"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Package Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={packageFormData.name}
                  onChange={(e) =>
                    setPackageFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors"
                  placeholder="e.g. Gold Plan"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Price ($) <span className="text-danger">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={packageFormData.price}
                    onChange={(e) =>
                      setPackageFormData((prev) => ({ ...prev, price: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors font-mono"
                    placeholder="e.g. 29.99"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Billing Cycle
                  </label>
                  <select
                    value={packageFormData.billing_cycle}
                    onChange={(e) =>
                      setPackageFormData((prev) => ({ ...prev, billing_cycle: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-surface text-ink focus:outline-none focus:border-ink transition-colors cursor-pointer"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              {/* Photographer Limitations */}
              <div className="pt-1">
                <div className="flex items-center gap-2 mb-2">
                  <Camera className="w-3.5 h-3.5 text-accent-dark" />
                  <h4 className="text-xs font-bold text-ink uppercase tracking-wide">
                    Photographer Limitations
                  </h4>
                </div>
                <p className="text-[11px] text-dim mb-3">
                  Turn on any limits you want to enforce for photographers on this package —
                  anything left off stays unlimited and won't appear under "Features Included".
                </p>
                <div className="space-y-3">
                  {PHOTOGRAPHER_LIMIT_FIELDS.map(({ key, label, unit, placeholder }) => (
                    <LimitFieldRow
                      key={key}
                      id={`enable-limit-${key}`}
                      label={label}
                      unit={unit}
                      placeholder={placeholder}
                      field={limitsFormData[key]}
                      onChange={(next) => updateLimitField(key, next)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Features Included <span className="text-dim font-normal">(comma-separated)</span>
                </label>

                {autoFeatures.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {autoFeatures.map((f) => (
                      <span
                        key={f}
                        title="Auto-generated from Photographer Limitations"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-accent/10 border border-accent/30 text-accent-dark"
                      >
                        <Sparkles className="w-2.5 h-2.5 shrink-0" />
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                <textarea
                  rows={3}
                  value={packageFormData.features}
                  onChange={(e) =>
                    setPackageFormData((prev) => ({ ...prev, features: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-chalk/30 focus:bg-surface focus:outline-none focus:border-ink transition-colors resize-none"
                  placeholder="e.g. Priority AI matching, Custom domain, Team collaboration (5 seats)"
                />
                <p className="text-[11px] text-dim mt-1">
                  {autoFeatures.length > 0
                    ? "The tags above are generated automatically from the limits and don't need to be typed here — just add anything extra."
                    : "Shown to customers on the pricing page."}
                </p>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsPackageModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-border bg-chalk hover:bg-border/30 text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPackage}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-ink text-chalk hover:bg-ink/80 disabled:opacity-50 transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  {submittingPackage ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-chalk border-t-transparent rounded-full animate-spin" />
                      {modalMode === "create" ? "Creating..." : "Saving..."}
                    </>
                  ) : (
                    <>
                      {modalMode === "create" ? (
                        <Plus className="w-4 h-4 text-accent" />
                      ) : (
                        <Pencil className="w-4 h-4 text-accent" />
                      )}
                      {modalMode === "create" ? "Create Package" : "Save Changes"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Package Confirmation Modal ─────────────── */}
      {deletingPackage && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-sm overflow-hidden animate-fade-up p-6 text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-danger/10 border border-danger/20 text-danger flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-display text-lg font-bold text-ink">Delete Package?</h3>
              <p className="text-xs text-dim mt-1">
                Are you sure you want to delete <span className="font-semibold text-ink">"{deletingPackage.name}"</span>? This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingPackage(null)}
                disabled={isDeletingPackage}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-border bg-chalk hover:bg-border/30 text-dim hover:text-ink transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePackage}
                disabled={isDeletingPackage}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-danger text-white hover:bg-danger/90 disabled:opacity-50 transition-all cursor-pointer shadow-sm active:scale-95"
              >
                {isDeletingPackage ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Package
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Application Confirmation Modal ───────────── */}
      {deletingApplication && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-sm overflow-hidden animate-fade-up p-6 text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-danger/10 border border-danger/20 text-danger flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-display text-lg font-bold text-ink">Delete Application?</h3>
              <p className="text-xs text-dim mt-1">
                Are you sure you want to delete <span className="font-semibold text-ink">"{deletingApplication.name}"</span>? This
                action cannot be undone. Any existing packages under app_id{" "}
                <span className="font-mono font-semibold text-ink">"{deletingApplication.app_id}"</span> stay in the
                database but will no longer be grouped under a registered app here.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingApplication(null)}
                disabled={isDeletingApplication}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-border bg-chalk hover:bg-border/30 text-dim hover:text-ink transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteApplication}
                disabled={isDeletingApplication}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-danger text-white hover:bg-danger/90 disabled:opacity-50 transition-all cursor-pointer shadow-sm active:scale-95"
              >
                {isDeletingApplication ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Application
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast notification ───────────────────────────────── */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </main>
  );
}
