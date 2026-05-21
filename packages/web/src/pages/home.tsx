import { useNavigate } from 'react-router-dom';
import { useInventory } from '@/api/hooks/use-inventory';
import { usePlans } from '@/api/hooks/use-plans';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle, PenLine, Library, ArrowRight, Layers } from 'lucide-react';

export default function HomePage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { activeCollection } = useCollection();
  const { data: inventory } = useInventory(activeCollection);
  const { data: plans } = usePlans();

  const approved = inventory?.by_quality?.approved ?? 0;
  const pending = (inventory?.by_quality?.reviewed ?? 0) + (inventory?.by_quality?.draft ?? 0);
  const planCount = plans?.length ?? 0;

  const stats = [
    { value: inventory?.total ?? 0, label: t('home', 'statFragments'), icon: Library, color: 'text-primary' },
    { value: approved, label: t('home', 'statApproved'), icon: CheckCircle, color: 'text-green-600' },
    { value: pending, label: t('home', 'statPending'), icon: Upload, color: 'text-amber-500' },
    { value: planCount, label: t('home', 'statPlans'), icon: PenLine, color: 'text-blue-500' },
  ];

  const steps = [
    {
      num: '01',
      icon: Upload,
      title: t('home', 'step1Title'),
      desc: t('home', 'step1Desc'),
      cta: t('home', 'step1Cta'),
      to: '/harvest',
      accent: 'border-blue-200 dark:border-blue-800',
      iconBg: 'bg-blue-50 dark:bg-blue-950',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    {
      num: '02',
      icon: CheckCircle,
      title: t('home', 'step2Title'),
      desc: t('home', 'step2Desc'),
      cta: t('home', 'step2Cta'),
      to: '/validation',
      accent: 'border-amber-200 dark:border-amber-800',
      iconBg: 'bg-amber-50 dark:bg-amber-950',
      iconColor: 'text-amber-600 dark:text-amber-400',
    },
    {
      num: '03',
      icon: PenLine,
      title: t('home', 'step3Title'),
      desc: t('home', 'step3Desc'),
      cta: t('home', 'step3Cta'),
      to: '/plan-generation',
      accent: 'border-green-200 dark:border-green-800',
      iconBg: 'bg-green-50 dark:bg-green-950',
      iconColor: 'text-green-600 dark:text-green-400',
    },
  ];

  return (
    <div className="min-h-full bg-muted/20">
      {/* Hero */}
      <div className="bg-background border-b px-8 py-10">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold mb-1">⬡ Fragmint</h1>
          <p className="text-lg font-medium text-foreground mb-3">{t('home', 'tagline')}</p>
          <p className="text-muted-foreground leading-relaxed max-w-2xl">
            {t('home', 'subtitle')}
          </p>
        </div>
      </div>

      <div className="px-8 py-8 max-w-5xl space-y-10">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s, i) => (
            <Card key={i} className="bg-background">
              <CardContent className="pt-5 pb-4">
                <s.icon className={`h-5 w-5 mb-3 ${s.color}`} />
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* How it works */}
        <div>
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-5">
            {t('home', 'howItWorks')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {steps.map((step, i) => (
              <div key={i} className="relative flex flex-col">
                <Card className={`flex-1 border-2 ${step.accent} bg-background hover:shadow-md transition-shadow`}>
                  <CardContent className="pt-6 pb-5 flex flex-col gap-4 h-full">
                    <div className="flex items-start justify-between">
                      <div className={`p-2.5 rounded-lg ${step.iconBg}`}>
                        <step.icon className={`h-5 w-5 ${step.iconColor}`} />
                      </div>
                      <span className="text-3xl font-black text-muted-foreground/20 leading-none">{step.num}</span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-base mb-2">{step.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between group"
                      onClick={() => nav(step.to)}
                    >
                      {step.cta}
                      <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </Button>
                  </CardContent>
                </Card>
                {i < steps.length - 1 && (
                  <div className="hidden md:flex absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-muted border items-center justify-center">
                    <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Collections */}
        <div className="flex gap-4 items-start p-5 rounded-xl border bg-background">
          <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
            <Layers className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <h2 className="font-semibold mb-1">{t('home', 'collectionsTitle')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('home', 'collectionsDesc')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
