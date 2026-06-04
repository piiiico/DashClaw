'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { RotateCcw, Save, ChevronDown, Layout, Trash2 } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { clearLayouts, loadLayouts, saveLayouts, loadNamedLayouts, saveNamedLayout, deleteNamedLayout } from '../lib/dashboardLayoutState';

const PRESET_NAMES = ['Operations Focus', 'Analytics Focus', 'Compact Overview', 'Developer'];

const DraggableDashboard = dynamic(() => import('../components/DraggableDashboard'), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={`bg-surface-secondary border border-border rounded-xl h-48 animate-pulse ${i < 2 ? 'md:col-span-2' : ''}`} />
      ))}
    </div>
  ),
});

export default function Dashboard() {
  const [resetKey, setResetKey] = useState(0);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [namedLayouts, setNamedLayouts] = useState({});
  const [activePreset, setActivePreset] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    setNamedLayouts(loadNamedLayouts());
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowLayoutMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleResetLayout = () => {
    clearLayouts();
    setActivePreset(null);
    setResetKey((k) => k + 1);
    setShowLayoutMenu(false);
  };

  const handleSaveLayout = () => {
    if (!saveName.trim()) return;
    const current = loadLayouts();
    if (current) {
      saveNamedLayout(saveName.trim(), current);
      setNamedLayouts(loadNamedLayouts());
    }
    setSaveName('');
    setShowSaveInput(false);
  };

  const handleLoadNamedLayout = (name) => {
    const all = loadNamedLayouts();
    if (all[name]?.layouts) {
      saveLayouts(all[name].layouts);
      setActivePreset(null);
      setResetKey((k) => k + 1);
    }
    setShowLayoutMenu(false);
  };

  const handleDeleteNamedLayout = (name, e) => {
    e.stopPropagation();
    deleteNamedLayout(name);
    setNamedLayouts(loadNamedLayouts());
  };

  const handleSelectPreset = (presetName) => {
    setActivePreset(presetName);
    setResetKey((k) => k + 1);
    setShowLayoutMenu(false);
  };

  return (
    <PageLayout
      title="Dashboard"
      subtitle="AI Agent Governance, Decision Accountability, and Compliance Controls"
      breadcrumbs={['Dashboard']}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSaveInput(!showSaveInput)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-secondary hover:text-secondary bg-surface-tertiary border border-border rounded-lg transition-colors"
            title="Save current layout"
          >
            <Save size={14} />
            Save Layout
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowLayoutMenu(!showLayoutMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-secondary hover:text-secondary bg-surface-tertiary border border-border rounded-lg transition-colors"
              title="Layout presets"
            >
              <Layout size={14} />
              Layouts
              <ChevronDown size={12} />
            </button>
            {showLayoutMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-surface-secondary border border-border-hover rounded-lg shadow-xl z-50 py-1">
                <div className="px-3 py-1.5 text-[10px] font-medium text-tertiary uppercase tracking-wider">Presets</div>
                {PRESET_NAMES.map(name => (
                  <button
                    key={name}
                    onClick={() => handleSelectPreset(name)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${activePreset === name ? 'text-brand bg-brand/10' : 'text-secondary hover:bg-white/5'}`}
                  >
                    {name}
                  </button>
                ))}
                {Object.keys(namedLayouts).length > 0 && (
                  <>
                    <div className="border-t border-border my-1" />
                    <div className="px-3 py-1.5 text-[10px] font-medium text-tertiary uppercase tracking-wider">Saved Layouts</div>
                    {Object.keys(namedLayouts).map(name => (
                      <div key={name} className="flex items-center group">
                        <button
                          onClick={() => handleLoadNamedLayout(name)}
                          className="flex-1 text-left px-3 py-2 text-xs text-secondary hover:bg-white/5 transition-colors truncate"
                        >
                          {name}
                        </button>
                        <button
                          onClick={(e) => handleDeleteNamedLayout(name, e)}
                          className="px-2 py-1 text-disabled hover:text-error opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
                <div className="border-t border-border my-1" />
                <button
                  onClick={handleResetLayout}
                  className="w-full text-left px-3 py-2 text-xs text-secondary hover:bg-white/5 transition-colors flex items-center gap-1.5"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              </div>
            )}
          </div>
        </div>
      }
    >
      {showSaveInput && (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Layout name..."
            className="w-48 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveLayout()}
            autoFocus
          />
          <button
            onClick={handleSaveLayout}
            disabled={!saveName.trim()}
            className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => { setShowSaveInput(false); setSaveName(''); }}
            className="px-3 py-1.5 rounded-lg text-secondary hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      <DraggableDashboard key={resetKey} activePreset={activePreset} />
    </PageLayout>
  );
}

