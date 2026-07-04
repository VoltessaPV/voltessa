import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Navbar from "../layout/Navbar";
import DashboardMock from "./DashboardMock";
import Footer from "../layout/Footer";


export default function Hero() {
  return (
    <>
      <Navbar />
      
      <section className="min-h-screen bg-[#050816] text-white flex items-center pt-8">
        <div className="mx-auto w-full max-w-[1600px] px-8 grid lg:grid-cols-[35%_65%] gap-12 items-center">

          <div>
            <Badge>
              AI-powered Renewable Operations
            </Badge>

            <h1 className="mt-8 text-5xl xl:text-6xl font-bold leading-tight">
              AI Platform
              <br />
              <span className="text-blue-500">
                for Solar & Battery
              </span>
              <br />
              Operations
            </h1>

            <p className="mt-8 max-w-xl text-lg text-slate-400 leading-8">
              Voltessa continuously monitors solar plants, battery systems,
              weather forecasts and electricity markets
              to automate operations and maximize revenue.
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
              SOLAR • BESS • MARKET • AI AUTOMATION
            </div>
          </div>

          <div className="flex justify-center">
            <DashboardMock />
          </div>

        </div>
      </section>

      <Footer />
    </>
  );
}