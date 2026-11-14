import numpy as np, math
src=open("h247_sim.py").read()
exec(src.split("# ---------------- E1: calibración")[0])
def tests2(Y):
    """métodos anteriores + variantes con r1 estimado SOBRE LA SERIE SIN TENDENCIA."""
    out=tests(Y); m,n=Y.shape; t=np.arange(n)
    # PWd: prewhitening de la serie original con r1 de la serie sin tendencia (Sen), MK sobre la serie blanqueada
    b=sen(Y); X=Y-b[:,None]*t; r=bc(r1_of(X),n)
    out['PWd']=mk_z(Y[:,1:]-r[:,None]*Y[:,:-1])
    # TFPW-WS (iterativo, Wang y Swail 2001): iterar r y pendiente corregida por el blanqueo
    bb=b.copy(); rr=r.copy()
    for _ in range(6):
        X=Y-bb[:,None]*t; rr=bc(r1_of(X),n)
        Yp=Y[:,1:]-rr[:,None]*Y[:,:-1]
        bb=sen_t(Yp,t[1:])/(1-rr)
    out['TFPW-WS']=mk_z(Yp)
    return out
def sen_t(Y,t):
    m,n=Y.shape; i,j=np.triu_indices(n,1); return np.median((Y[:,j]-Y[:,i])/(t[j]-t[i]),axis=1)
if __name__=="__main__":
    M=12000; names=['MK ingenuo','MK-VC','PW','TFPW-Y','OLS-AR1','PWd','TFPW-WS']
    for n,phi in ((23,0.3),(23,0.5),(40,0.5)):
        print(f"\nn={n}  φ={phi} — % de series declaradas significativas según el efecto real (σ/década)")
        print(f"{'efecto':>7} | "+" ".join(f"{k:>10}" for k in names))
        for eff in (0,0.5,1,2,3,5):
            zs=tests2(gen(M,n,phi,slope=eff/10))
            print(f"{eff:>7} | "+" ".join(f"{100*(np.abs(zs[k])>Z).mean():>9.1f}%" for k in names),flush=True)
