import numpy as np, math
src=open("h247_sim.py").read()
exec(src.split("# ---------------- E1: calibración")[0])
exec("def field"+src.split("def field")[1].split("R = 150")[0])
exec(open("diag_power.py").read().split("if __name__")[0].split("exec(src.split")[1].split("\n",1)[1])  # tests2, sen_t
from math import erf
zc={0.05:1.959964,0.025:2.241403,0.01:2.575829}
def cons3(zs): return np.minimum.reduce([np.abs(zs['MK-VC']),np.abs(zs['TFPW-WS']),np.abs(zs['OLS-AR1'])])   # significativo si los 3 lo son
M=10000
print("Q1 · tasa de falsas alarmas (efecto 0) y potencia (1 y 2 σ/década) por regla y umbral α")
for n,phi in ((23,0.3),(23,0.5),(40,0.5)):
    print(f"\nn={n} φ={phi}")
    print(f"{'regla':<26}{'α':>6} | {'falsas':>7} {'pot 1σ':>7} {'pot 2σ':>7}")
    Z0=tests2(gen(M,n,phi)); Z1=tests2(gen(M,n,phi,slope=0.1)); Z2=tests2(gen(M,n,phi,slope=0.2))
    rules={'MK-VC':lambda z:np.abs(z['MK-VC']),'TFPW-WS':lambda z:np.abs(z['TFPW-WS']),'PWd':lambda z:np.abs(z['PWd']),'consenso(VC,WS,OLS)':cons3}
    for name,f in rules.items():
        for a,zc_ in zc.items():
            print(f"{name:<26}{a:>6} | {100*(f(Z0)>zc_).mean():>6.1f}% {100*(f(Z1)>zc_).mean():>6.1f}% {100*(f(Z2)>zc_).mean():>6.1f}%",flush=True)
print("\nQ2 · FDR en el mapa (60×60, n=23, φ=0.3): proporción de falsas entre lo marcado y zona real detectada")
R=60
for lab,blk in (('señal escasa (4 % del mapa, 1.2 σ/déc)',12),('señal abundante (16 % del mapa, 1.2 σ/déc)',24)):
    print(lab)
    for name,pf in (('p(MK-VC)',lambda z:p_two(z['MK-VC'])),('p(consenso)',lambda z:p_two(cons3(z)))):
        for q in (0.10,0.05):
            fd=[];pw=[];nl=[]
            for _ in range(R):
                Y,_m=field(23,0.3); nl.append(bh(pf(tests2(Y)),q).mean())
                Y,mk=field(23,0.3,blockslope=0.12,block=blk); fl=bh(pf(tests2(Y)),q); tot=fl.sum()
                fd.append((fl&~mk).sum()/tot if tot else 0.0); pw.append((fl&mk).sum()/mk.sum())
            print(f"   {name:<14} q={q:<5} mapa vacío marcado {100*np.mean(nl):5.2f}% | falsas entre marcadas {100*np.mean(fd):5.1f}% | zona real {100*np.mean(pw):5.1f}%",flush=True)
