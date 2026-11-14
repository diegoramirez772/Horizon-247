"""Simulaciones de la Etapa 3 (Análisis) de HORIZON 247. Solo numpy. Semilla fija."""
import numpy as np, math, time, sys
rng = np.random.default_rng(247)

def erfc_vec(x):
    """erfc para x>=0 (Abramowitz-Stegun 7.1.26, error < 1.5e-7)."""
    x = np.asarray(x, float); t = 1.0/(1.0+0.3275911*x)
    poly = t*(0.254829592+t*(-0.284496736+t*(1.421413741+t*(-1.453152027+t*1.061405429))))
    return poly*np.exp(-x*x)
def p_two(z): return erfc_vec(np.abs(z)/math.sqrt(2))
def Phi(x):
    x = np.asarray(x, float); e = erfc_vec(np.abs(x)/math.sqrt(2))
    return np.where(x >= 0, 1-0.5*e, 0.5*e)

def gen(m, n, phi, slope=0.0):
    """m series AR(1) con sd marginal 1 + tendencia lineal (slope por año)."""
    e = np.empty((m, n)); e[:, 0] = rng.standard_normal(m)
    s = math.sqrt(1-phi**2)
    for t in range(1, n): e[:, t] = phi*e[:, t-1] + s*rng.standard_normal(m)
    return e + slope*np.arange(n)

def mk_z(Y):
    m, n = Y.shape; S = np.zeros(m)
    for i in range(n-1): S += np.sign(Y[:, i+1:]-Y[:, [i]]).sum(1)
    return (S-np.sign(S))/math.sqrt(n*(n-1)*(2*n+5)/18)

def sen(Y):
    m, n = Y.shape; i, j = np.triu_indices(n, 1)
    return np.median((Y[:, j]-Y[:, i])/(j-i), axis=1)

def r1_of(X):
    xc = X-X.mean(1, keepdims=True)
    return (xc[:, 1:]*xc[:, :-1]).sum(1)/(xc**2).sum(1)
def bc(r, n): return np.clip(r+(1+3*r)/n, 0.0, 0.95)   # sesgo de r1 (Kendall 1954), recortado a >=0

def tests(Y):
    """z de cada método. n columnas."""
    m, n = Y.shape; t = np.arange(n); out = {}
    z0 = mk_z(Y); out['MK ingenuo'] = z0
    b = sen(Y); X = Y-b[:, None]*t; r = bc(r1_of(X), n)            # r1 de la serie sin tendencia
    out['MK-VC'] = z0/np.sqrt((1+r)/(1-r))
    rr = np.clip(r1_of(Y), 0, 0.95)                                  # PW (Kulkarni-von Storch)
    out['PW'] = mk_z(Y[:, 1:]-rr[:, None]*Y[:, :-1])
    Xp = X[:, 1:]-r[:, None]*X[:, :-1]                               # TFPW-Y (Yue 2002)
    out['TFPW-Y'] = mk_z(Xp+b[:, None]*t[1:])
    tc = t-t.mean(); Sxx = (tc**2).sum()                              # OLS con varianza AR(1)
    bo = ((Y-Y.mean(1, keepdims=True))*tc).sum(1)/Sxx
    res = Y-Y.mean(1, keepdims=True)-bo[:, None]*tc; ro = bc(r1_of(res), n)
    s2 = (res**2).sum(1)/(n-2); se = np.sqrt(s2/Sxx*(1+ro)/(1-ro))
    out['OLS-AR1'] = bo/se
    return out

Z = 1.959964
def banner(s): print("\n"+"="*78+"\n"+s+"\n"+"="*78, flush=True)

# ---------------- E1: calibración bajo H0 y potencia -----------------
banner("E1 · FALSAS ALARMAS sin tendencia real (nominal 5 %), 20 000 series por celda")
M = 20000; names = ['MK ingenuo', 'MK-VC', 'PW', 'TFPW-Y', 'OLS-AR1']
print(f"{'n':>3} {'phi':>4} | " + " ".join(f"{k:>10}" for k in names) + " |  2-de-3*")
for n in (15, 23, 40):
    for phi in (0.0, 0.3, 0.5, 0.7):
        zs = tests(gen(M, n, phi)); row = []
        for k in names: row.append((np.abs(zs[k]) > Z).mean())
        agree = ((np.abs(zs['MK-VC']) > Z).astype(int)+(np.abs(zs['PW']) > Z)+(np.abs(zs['TFPW-Y']) > Z) >= 2).mean()
        print(f"{n:>3} {phi:>4} | " + " ".join(f"{100*v:>9.1f}%" for v in row) + f" | {100*agree:>6.1f}%", flush=True)
print("* 2-de-3 = significativo en al menos 2 de {MK-VC, PW, TFPW-Y}")

banner("E1b · POTENCIA con tendencia de 1 σ por década (efecto moderado)")
print(f"{'n':>3} {'phi':>4} | " + " ".join(f"{k:>10}" for k in names) + " |  2-de-3*")
for n in (23, 40):
    for phi in (0.3, 0.5):
        zs = tests(gen(M, n, phi, slope=0.1)); row = []
        for k in names: row.append((np.abs(zs[k]) > Z).mean())
        agree = ((np.abs(zs['MK-VC']) > Z).astype(int)+(np.abs(zs['PW']) > Z)+(np.abs(zs['TFPW-Y']) > Z) >= 2).mean()
        print(f"{n:>3} {phi:>4} | " + " ".join(f"{100*v:>9.1f}%" for v in row) + f" | {100*agree:>6.1f}%", flush=True)

# ---------------- E2: campo espacial, FDR -----------------
banner("E2 · MAPA con correlación espacial: ¿cuántas celdas marca cada enfoque?")
def field(n, phi, L=60, sig=3.0, blockslope=0.0, block=12):
    k = np.fft.fftfreq(L); K2 = k[:, None]**2+k[None, :]**2
    filt = np.exp(-2*(np.pi*sig)**2*K2)                               # filtro gaussiano en Fourier
    def smooth(w):
        f = np.real(np.fft.ifft2(np.fft.fft2(w)*filt)); return f
    base = smooth(rng.standard_normal((L, L))); sd = base.std()       # para normalizar a sd 1
    e = np.empty((n, L, L)); e[0] = smooth(rng.standard_normal((L, L)))/sd
    s = math.sqrt(1-phi**2)
    for t in range(1, n): e[t] = phi*e[t-1]+s*smooth(rng.standard_normal((L, L)))/sd
    Y = e.reshape(n, -1).T.copy()                                      # (celdas, n)
    mask = np.zeros((L, L), bool)
    if blockslope: 
        mask[24:24+block, 24:24+block] = True
        Y[mask.ravel()] += blockslope*np.arange(n)
    return Y, mask.ravel()
def bh(p, q):
    m = p.size; o = np.argsort(p); ok = p[o] <= q*(np.arange(1, m+1)/m)
    keep = np.zeros(m, bool)
    if ok.any(): keep[o[:np.max(np.where(ok)[0])+1]] = True
    return keep
R = 150; n = 23; phi = 0.3
res = {k: [] for k in ['naive_null', 'vc_null', 'bh_null', 'naive_fdp', 'vc_fdp', 'bh_fdp', 'naive_pw', 'vc_pw', 'bh_pw']}
for _ in range(R):
    Y, _m = field(n, phi); zs = tests(Y)
    res['naive_null'].append((np.abs(zs['MK ingenuo']) > Z).mean())
    res['vc_null'].append((np.abs(zs['MK-VC']) > Z).mean())
    res['bh_null'].append(bh(p_two(zs['MK-VC']), 0.10).mean())
    Y, mk = field(n, phi, blockslope=0.12); zs = tests(Y)             # 1.2 σ/década en un bloque de 4 % del mapa
    for key, flag in (('naive', np.abs(zs['MK ingenuo']) > Z), ('vc', np.abs(zs['MK-VC']) > Z), ('bh', bh(p_two(zs['MK-VC']), 0.10))):
        tot = flag.sum(); res[key+'_fdp'].append(((flag & ~mk).sum()/tot) if tot else 0.0); res[key+'_pw'].append((flag & mk).sum()/mk.sum())
mean = lambda k: 100*np.mean(res[k])
print(f"Malla 60×60 (3 600 celdas), n={n}, phi={phi}, correlación espacial σ=3 celdas, {R} mapas")
print("SIN ninguna tendencia real — % del mapa marcado «significativo» (todo es falso):")
print(f"   MK ingenuo (α=5 %) ........ {mean('naive_null'):5.1f} %")
print(f"   MK-VC     (α=5 %) ........ {mean('vc_null'):5.1f} %")
print(f"   MK-VC + FDR (q=10 %) ...... {mean('bh_null'):5.2f} %")
print("CON tendencia real de 1.2 σ/década en un bloque del 4 % del mapa:")
print(f"   {'enfoque':<22}{'proporción de falsos entre lo marcado':>40}{'zonas reales detectadas':>26}")
for lab, key in (('MK ingenuo', 'naive'), ('MK-VC', 'vc'), ('MK-VC + FDR', 'bh')):
    print(f"   {lab:<22}{mean(key+'_fdp'):>39.1f}%{mean(key+'_pw'):>25.1f}%")
sys.stdout.flush()

# ---------------- E3: veredicto de tres estados -----------------
banner("E3 · VEREDICTO de tres estados: ¿es honesto? (20 000 series por fila)")
print("Regla: «probado» si MK-VC es significativo; si no, se estima la potencia para detectar δ;")
print("       potencia ≥ 80 % → «sin cambio ≥ δ»; si no → «no concluyente».  Efecto en σ por década.")
def verdict(Y, delta_dec):
    n = Y.shape[1]; zs = tests(Y); sig = np.abs(zs['MK-VC']) > Z
    t = np.arange(n); tc = t-t.mean(); Sxx = (tc**2).sum()
    bo = ((Y-Y.mean(1, keepdims=True))*tc).sum(1)/Sxx
    res = Y-Y.mean(1, keepdims=True)-bo[:, None]*tc; ro = bc(r1_of(res), n)
    s = np.sqrt((res**2).sum(1)/(n-2)); se = s*np.sqrt(1/Sxx*(1+ro)/(1-ro))
    d = (delta_dec/10)*s                                                # δ por año en unidades de la serie
    pw = Phi(d/se-Z)+Phi(-d/se-Z)
    v = np.where(sig, 0, np.where(pw >= 0.8, 2, 1))                    # 0 probado, 1 no concluyente, 2 sin cambio ≥δ
    return v, pw
print(f"{'n':>3} {'phi':>4} {'δ':>4} {'efecto real':>12} | {'probado':>8} {'no concl.':>10} {'sin cambio≥δ':>13} | potencia est. mediana")
for n in (23, 40):
    for phi in (0.3,):
        for dd in (1.0, 2.0):
            for lab, mult in (('0 (nada)', 0.0), ('0.5 δ', 0.5), ('δ', 1.0), ('2 δ', 2.0)):
                Y = gen(M, n, phi, slope=mult*dd/10); v, pw = verdict(Y, dd)
                print(f"{n:>3} {phi:>4} {dd:>4.1f} {lab:>12} | {100*(v==0).mean():>7.1f}% {100*(v==1).mean():>9.1f}% {100*(v==2).mean():>12.1f}% | {np.median(pw):>6.2f}", flush=True)

# ---------------- E4: rendimiento -----------------
banner("E4 · COSTO DE CÓMPUTO (1 núcleo, numpy)")
for (m, n, lab) in ((75000, 23, "75 000 celdas de tierra × 23 años (anual)"), (2000, 276, "2 000 celdas × 276 meses (mensual)")):
    Y = gen(m, n, 0.3); t0 = time.time(); zs = tests(Y); _ = sen(Y); dt = time.time()-t0
    print(f"{lab}: {dt:6.1f} s" + (f"  → extrapolado a 75 000 celdas: {dt*75000/m/60:5.1f} min" if m != 75000 else ""), flush=True)
