import numpy as np, math
src=open("h247_sim.py").read()
exec(src.split("# ---------------- E1: calibración")[0])
exec(open("diag_power.py").read().split("if __name__")[0].split("exec(src.split")[1].split("\n",1)[1])
def cons3(zs): return np.minimum.reduce([np.abs(zs['MK-VC']),np.abs(zs['TFPW-WS']),np.abs(zs['OLS-AR1'])])
k80=1.959964+0.841621
def power(n,phi,sd,M=4000): return (cons3(tests2(gen(M,n,phi,slope=sd/10)))>Z).mean()
print("MDE (80 % de potencia) de la regla de CONSENSO vs MDE ideal — σ por década")
print(f"{'n':>3} {'phi':>4} | {'ideal':>6} {'consenso':>9} {'factor':>7}")
for n in (15,23,40):
    for phi in (0.0,0.3,0.5):
        ideal=10*k80*math.sqrt(12/(n*(n*n-1))*(1+phi)/(1-phi)); lo,hi=0.05,8.0
        for _ in range(8):
            mid=(lo+hi)/2
            if power(n,phi,mid)<0.8: lo=mid
            else: hi=mid
        e=(lo+hi)/2; print(f"{n:>3} {phi:>4} | {ideal:>6.2f} {e:>9.2f} {e/ideal:>7.2f}",flush=True)
