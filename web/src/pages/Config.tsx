import { Settings } from 'lucide-react';

export default function Config() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-blue-400" />
        <h2 className="text-body-sm-medium text-white">Configuration</h2>
      </div>

      <div className="bg-gray-900 rounded-[4px] border border-gray-800 p-8 text-center">
        <Settings className="h-12 w-12 text-gray-600 mx-auto mb-4" />
        <p className="text-label-lg text-gray-400">Coming Soon</p>
        <p className="text-caption text-gray-500 mt-2">
          Configuration management via WebSocket is not yet available.
          Edit your config file directly or use the CLI.
        </p>
      </div>
    </div>
  );
}
