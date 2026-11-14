import numpy as np
exec(open("h247_sim.py").read().split("# ---------------- E1: calibración")[0])   # reusa funciones
M=20000
print("E1c · Regla «PW y TFPW-Y coinciden» (idea del 3PW de Collaud Coen 2020) y «PW y MK-VC coinciden»")
print(f"{'n':>3} {'phi':>4} | {'falsas alarmas  PW∧TFPW':>24} {'PW∧VC':>8} | {'potencia 1σ/déc  PW∧TFPW':>26} {'PW∧VC':>8}")
for n in (23,40):
    for phi in (0.3,0.5,0.7):
        z0=tests(gen(M,n,phi)); z1=tests(gen(M,n,phi,slope=0.1))
        s=lambda z,a,b:((np.abs(z[a])>Z)&(np.abs(z[b])>Z)).mean()*100
        print(f"{n:>3} {phi:>4} | {s(z0,'PW','TFPW-Y'):>23.1f}% {s(z0,'PW','MK-VC'):>7.1f}% | {s(z1,'PW','TFPW-Y'):>25.1f}% {s(z1,'PW','MK-VC'):>7.1f}%",flush=True)
