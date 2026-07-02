export default function BrowserBar() {
    return (
        <div className="flex items-center gap-2 border-b border-slate-800 px-6 py-4">
            <div className="h-3 w-3 rounded-full bg-slate-600" />
            <div className="h-3 w-3 rounded-full bg-slate-600" />
            <div className="h-3 w-3 rounded-full bg-slate-600" />

            <div className="ml-auto text-xs tracking-wider text-slate-500">
                app.voltessa.ai
            </div>
        </div>
    );
}