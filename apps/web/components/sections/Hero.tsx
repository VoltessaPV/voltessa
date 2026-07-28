import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

import Badge from "../ui/Badge";
import { RequestDemoButton } from "../ui/RequestDemoButton";
import { TalkToUsButton } from "../ui/TalkToUsButton";
import Navbar from "../layout/Navbar";
import { PlatformPreview } from "./PlatformPreview";
import SolutionsSection from "./SolutionsSection";
import AboutSection from "./AboutSection";
import RoadmapSection from "./RoadmapSection";
import ContactSection from "./ContactSection";
import Footer from "../layout/Footer";
import { CTAProvider } from "../providers/CTAProvider";


export default async function Hero() {
  const user = await getCurrentUser();
  const isAuthenticated = user !== null;

  return (
    <CTAProvider>
      <Navbar />

      <section id="hero" className="min-h-screen bg-[#050816] text-white flex items-center pt-8">
        <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-8 grid lg:grid-cols-[35%_65%] gap-12 items-center">

          <div>
            <Badge>
              AI-powered Renewable Operations
            </Badge>

            <h1 className="mt-8 text-3xl font-bold leading-tight sm:text-4xl md:text-5xl xl:text-6xl">
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

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <RequestDemoButton className="w-full text-center sm:w-auto" />

              <TalkToUsButton className="w-full text-center sm:w-auto" />
            </div>

            <Link
              href={isAuthenticated ? routes.dashboard : routes.login}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-slate-300 transition hover:text-blue-400"
            >
              {isAuthenticated ? "Go to My Voltessa" : "Create Account"}
              <span aria-hidden="true">→</span>
            </Link>

            <div className="mt-10 tracking-[0.35em] text-sm uppercase text-slate-500">
              SOLAR • BESS • MARKET • AI AUTOMATION
            </div>
          </div>

          <div className="flex justify-center">
            <PlatformPreview />
          </div>

        </div>
      </section>

      <SolutionsSection />

      <AboutSection />

      <RoadmapSection />

      <ContactSection />

      <Footer />
    </CTAProvider>
  );
}