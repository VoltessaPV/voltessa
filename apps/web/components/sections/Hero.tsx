import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Navbar from "../layout/Navbar";
import DashboardMock from "./DashboardMock";


export default function Hero() {
  return (
    <>
      <Navbar />
      
      <section className="min-h-screen bg-[#050816] text-white flex items-center">
        <div className="mx-auto max-w-7xl px-8 grid lg:grid-cols-2 gap-16 items-center">

          <div>
            <Badge>
              Intelligent renewable operations
            </Badge>

            <h1 className="mt-8 text-6xl font-bold leading-tight">
              AI Platform for
              <br />
              <span className="text-blue-500">
                Profitable Solar
              </span>
              <br />
              & Battery Operations
            </h1>

            <p className="mt-8 max-w-xl text-xl text-slate-400 leading-8">
              Monitor, optimize and automate renewable energy assets
              from one intelligent platform — turning operational
              data into increased profitability.
            </p>

            <div className="mt-10 flex gap-4">
              <Button>
                Request Demo
              </Button>

              <Button variant="secondary">
                Talk to Us
              </Button>
            </div>

            <div className="mt-10 tracking-[0.35em] text-sm uppercase text-slate-500">
              Energy Flow • Data Intelligence
            </div>
          </div>

          <div className="flex justify-center">
            <DashboardMock />
          </div>

        </div>
      </section>
    </>
  );
}