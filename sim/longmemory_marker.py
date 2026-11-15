"""Long memory: how much the «robusto a memoria larga» marker (fixed H) cuts false claims and costs in power.

    PYTHONPATH=packages/hori/src python3 sim/longmemory_marker.py
Per-cell rates at alpha = 0.05 (no FDR): `all3` = the three voting tests agree; `robust(H)` = all3 AND Mann-Kendall z shrunk to the
variance of fGn(H) is still significant. Numbers are in docs/MODEL_CARD.md section 3.10.
"""
import numpy as np
from hori.longmemory import mk_variance, fgn_acf
from hori.stats import analyze, p_two
rng=np.random.default_rng(11)
def fgn(H,n,m):
    R=np.array([fgn_acf(H,n)[np.abs(a-np.arange(n))] for a in range(n)]); L=np.linalg.cholesky(R+1e-12*np.eye(n)); return rng.standard_normal((m,n))@L.T
def ar1(phi,n,m):
    e=rng.standard_normal((m,n)); x=np.zeros((m,n)); x[:,0]=e[:,0]
    for t in range(1,n): x[:,t]=phi*x[:,t-1]+np.sqrt(1-phi*phi)*e[:,t]
    return x
def rw(n,m): return np.cumsum(rng.standard_normal((m,n)),axis=1)
M=4000
for n in (24,45):
    v0=n*(n-1)*(2*n+5)/18
    c={H:np.sqrt(v0/mk_variance(n,H)) for H in (0.6,0.7,0.8)}
    print(f"--- n={n} ; cols: all3 | all3&robust(H=.6) | (H=.7) | (H=.8)")
    for name,gen,tr in (("white",lambda:rng.standard_normal((M,n)),0),("AR1 .3",lambda:ar1(.3,n,M),0),("fGn .7",lambda:fgn(.7,n,M),0),("fGn .8",lambda:fgn(.8,n,M),0),("fGn .9",lambda:fgn(.9,n,M),0),("randwalk",lambda:rw(n,M),0),
                        ("white+1s",lambda:rng.standard_normal((M,n)),1.0),("white+2s",lambda:rng.standard_normal((M,n)),2.0),("AR1.3+1s",lambda:ar1(.3,n,M),1.0),("fGn.7+2s",lambda:fgn(.7,n,M),2.0)):
        Y=gen()+ (tr/10)*np.arange(n)[None,:]; s=analyze(Y)
        a3=(p_two(s["z_vc"])<=.05)&(p_two(s["z_ws"])<=.05)&(p_two(s["z_ols"])<=.05)
        out=[a3.mean()]+[(a3&(np.abs(s["z_naive"])*c[H]>=1.959964)).mean() for H in (0.6,0.7,0.8)]
        print(f"{name:9s}"," ".join(f"{x:.3f}" for x in out))
