// Helper para verificar expiración en frontend
export function checkIsExpired(user) {
  if (!user || user.role === 'admin') return false;
  if (!user.licenseExpiresAt) return true;
  return new Date(user.licenseExpiresAt).getTime() < new Date().getTime();
}

// Helper para calcular barra de consumo de días de licencia
export function calculateLicenseProgress(user) {
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
}
