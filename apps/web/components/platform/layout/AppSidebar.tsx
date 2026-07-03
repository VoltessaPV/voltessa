import Link from "next/link";

const items = [
  "Overview",
  "Plants",
  "BESS",
  "Market",
  "Automation",
  "Reports",
];

export default function AppSidebar() {
  return (
    <aside className="flex h-full flex-col border-r border-slate-800 bg-[#0B1020]">

      <div className="border-b border-slate-800 p-6">
        <h2 className="text-2xl font-bold text-white">
          Voltessa
        </h2>
      </div>

      <nav className="flex-1 px-4 py-6">

        <ul className="space-y-2">

          {items.map((item) => (
            <li key={item}>

              <Link
                href="#"
                className="
                  block
                  rounded-lg
                  px-4
                  py-3
                  text-slate-300
                  transition
                  hover:bg-slate-800
                  hover:text-white
                "
              >
                {item}
              </Link>

            </li>
          ))}

        </ul>

      </nav>

    </aside>
  );
}