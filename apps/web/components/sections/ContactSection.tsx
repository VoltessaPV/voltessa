import { CONTACT_EMAIL } from "@/lib/constants";

import Badge from "../ui/Badge";
import { RequestDemoButton } from "../ui/RequestDemoButton";
import { TalkToUsButton } from "../ui/TalkToUsButton";

/**
 * The landing page's Contact section — the Navbar's "Contact" link
 * smooth-scrolls here (id="contact"). Same CTA components used everywhere
 * else on the page (RequestDemoButton/TalkToUsButton both go through the
 * shared CTAProvider, so clicking either here opens the exact same modal
 * as the Hero/Navbar buttons do).
 */
export default function ContactSection() {
  return (
    <section id="contact" className="border-t border-slate-900 bg-[#050816] py-24 text-white">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-8 lg:grid-cols-2">
        <div>
          <Badge>Contact</Badge>

          <h2 className="mt-8 text-4xl font-bold leading-tight">
            Let&apos;s discuss your solar portfolio.
          </h2>

          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
            Whether you&apos;re operating one utility-scale plant or an entire
            fleet, we&apos;d love to show you how Voltessa can automate your
            operations.
          </p>

          <div className="mt-10 space-y-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Email</p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="mt-1 block text-white transition hover:text-blue-400"
              >
                {CONTACT_EMAIL}
              </a>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Location</p>
              <p className="mt-1 text-white">Sofia, Bulgaria</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row lg:justify-end">
          <RequestDemoButton />
          <TalkToUsButton />
        </div>
      </div>
    </section>
  );
}
