import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGetActivityTaskSettings, useUpdateActivityTaskSettings, getGetActivityTaskSettingsQueryKey, getGetCampaignDeliveryQueryKey } from '@workspace/api-client-react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { anchorAt, localDateTimeValue } from '@/lib/timezone';

export default function ActivityTaskSettingsPanel({ campaignId, node }: { campaignId: string; node: any }) {
  const isWebinar = node.data.type === 'Webinar';
  const qc = useQueryClient();
  const { data: settings, isLoading } = useGetActivityTaskSettings(campaignId, node.id);
  const updateSettings = useUpdateActivityTaskSettings();
  
  const [localData, setLocalData] = useState<any>(null);
  const [tzError, setTzError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (settings && !updateSettings.isPending) {
      setLocalData({
        tier: settings.tier || 'none',
        timezone: settings.timezone || 'UTC',
        gtmLaunchAt: settings.timezone && settings.gtmLaunchAt ? localDateTimeValue(settings.gtmLaunchAt, settings.timezone) : '',
        eventAt: settings.timezone && settings.eventAt ? localDateTimeValue(settings.eventAt, settings.timezone) : ''
      });
    }
  }, [settings, updateSettings.isPending]);

  if (isLoading || !localData) {
    return <div className="py-4 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading execution settings...</div>;
  }

  const handleChange = (key: string, value: any) => {
    setLocalData((prev: any) => ({ ...prev, [key]: value }));
    setTzError('');
    setSaveError('');
    setShowSuccess(false);
  };

  const handleSave = () => {
    setTzError('');
    setSaveError('');
    setShowSuccess(false);
    
    // Validate timezone
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: localData.timezone });
    } catch {
      setTzError('Invalid IANA timezone.');
      return;
    }

    let parsedGtm: string | null = null;
    let parsedEvent: string | null = null;

    if (localData.gtmLaunchAt) {
      parsedGtm = anchorAt(localData.gtmLaunchAt, localData.timezone);
      if (!parsedGtm) {
        setTzError('Invalid GTM Launch date/time.');
        return;
      }
    }

    if (localData.eventAt && !isWebinar) {
      parsedEvent = anchorAt(localData.eventAt, localData.timezone);
      if (!parsedEvent) {
        setTzError('Invalid Event date/time.');
        return;
      }
    }

    const payload = {
      tier: localData.tier === 'none' ? null : localData.tier,
      timezone: localData.timezone,
      gtmLaunchAt: parsedGtm,
      eventAt: isWebinar ? (settings?.eventAt || null) : parsedEvent,
    };

    updateSettings.mutate({ 
      id: campaignId, 
      activityId: node.id, 
      data: payload 
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetActivityTaskSettingsQueryKey(campaignId, node.id) });
        qc.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2500);
      },
      onError: (err: any) => {
        setSaveError(err?.message || 'Failed to save settings');
      }
    });
  };

  const isDirty = settings && (
    (localData.tier === 'none' ? null : localData.tier) !== (settings.tier || null) ||
    localData.timezone !== (settings.timezone || 'UTC') ||
    localData.gtmLaunchAt !== (settings.timezone && settings.gtmLaunchAt ? localDateTimeValue(settings.gtmLaunchAt, settings.timezone) : '') ||
    localData.eventAt !== (settings.timezone && settings.eventAt ? localDateTimeValue(settings.eventAt, settings.timezone) : '')
  );

  return (
    <div className="space-y-4 pt-4 mt-4 border-t border-border">
      <h4 className="text-sm font-medium text-foreground pb-1">Execution Scheduling & Settings</h4>
      
      {(tzError || saveError) && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-2 rounded-md flex items-center gap-1.5 font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {tzError || saveError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">Tier <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded uppercase tracking-wider ml-1">Informational</span></Label>
          <Select 
            value={localData.tier}
            onValueChange={(val) => handleChange('tier', val)}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="Gold">Gold</SelectItem>
              <SelectItem value="Silver">Silver</SelectItem>
              <SelectItem value="Bronze">Bronze</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Timezone (IANA)</Label>
          <Input 
            value={localData.timezone}
            onChange={(e) => handleChange('timezone', e.target.value)}
            placeholder="e.g. America/New_York"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">GTM Launch At</Label>
          <Input 
            type="datetime-local"
            value={localData.gtmLaunchAt}
            onChange={(e) => handleChange('gtmLaunchAt', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            Event At
            {isWebinar && <span className="text-[9px] bg-primary/10 text-primary px-1 rounded uppercase tracking-wider">Webinar</span>}
          </Label>
          <Input 
            type="datetime-local"
            value={localData.eventAt}
            onChange={(e) => handleChange('eventAt', e.target.value)}
            disabled={isWebinar}
            className="h-8 text-sm"
            title={isWebinar ? "Uses webinar event time" : ""}
          />
        </div>
      </div>
      
      <div className="flex items-center justify-end gap-3 pt-2">
        {showSuccess && (
          <span className="text-xs font-medium text-green-600 flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <Button 
          size="sm" 
          onClick={handleSave} 
          disabled={updateSettings.isPending || (!isDirty && !tzError && !saveError)}
        >
          {updateSettings.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
