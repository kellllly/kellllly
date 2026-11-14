import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AlertTriangle, ArrowRight, BookOpen, Check, FileText, Headphones, Plus, Wifi } from 'lucide-react';
import { formatWAT } from '@/lib/itsm';
import { useStore } from '@/lib/store';
import type { KedbArticle } from '@/lib/types';
import { Badge, Button, dialogStickyActionsCls, EmptyState, Field, MiniStat, Modal, PageIntro, SearchBox, SectionTitle, Warning, inputCls, pad2, textareaCls } from '@/components/kit';
import { usePeople } from '@/hooks/use-people';
import { DiagnosticAssistant } from '@/components/diagnostic-assistant';
import { useReviewItsmKnowledgeArticle } from '@workspace/api-client-react';

const guides = [
  { title: 'Accéder à la messagerie collaborative', category: 'Collaboration', time: '3 min', body: 'Ouvrez votre espace de travail depuis le menu latéral, puis sélectionnez la conversation souhaitée. Vérifiez le nom de l’espace avant d’envoyer un message. Cette procédure de démonstration ne remplace pas les consignes internes.' },
  { title: 'Signaler un incident informatique', category: 'Support', time: '4 min', body: 'Depuis Tickets IT, choisissez « Créer un ticket ». Indiquez l’impact et l’urgence : la priorité P1 à P4 est calculée automatiquement. Décrivez l’impact technique observé, le service concerné et le moment de survenue. N’ajoutez aucun contenu métier, information personnelle ou élément d’enquête.' },
  { title: 'Préparer son poste de travail', category: 'Équipement', time: '5 min', body: 'Vérifiez l’alimentation, la connexion réseau et l’état des périphériques. En cas de problème persistant, ouvrez une demande depuis le Parc matériel : le numéro d’inventaire est prérempli.' },
];

export default function ServicesPage() { const { person } = usePeople();
  const { store, setStore, log } = useStore();
  const readOnlyAuditor = store.profile.clearance.startsWith('N5 ·');
  const canReviewKedb = /^(N1|N3) ·/u.test(store.profile.clearance);
  const search = useSearch(); const [, setLocation] = useLocation();
  const [query, setQuery] = useState(''); const [category, setCategory] = useState('Toutes');
  const [kq, setKq] = useState('');
  const [guide, setGuide] = useState<string | null>(null);
  const [service, setService] = useState<string | null>(null);
  const [article, setArticle] = useState<KedbArticle | null>(null);
  const [reviewDraft, setReviewDraft] = useState({ title: '', symptom: '', rootCause: '', resolution: '' });
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState('');
  const reviewArticle = useReviewItsmKnowledgeArticle();

  const openArticle = (value: KedbArticle) => {
    setArticle(value);
    setReviewDraft({ title: value.title, symptom: value.symptom, rootCause: value.rootCause, resolution: value.resolution });
    setReviewComment(value.reviewFeedback ?? '');
    setReviewError('');
  };
  useEffect(() => { const k = new URLSearchParams(search).get('kedb'); if (k) { const found = store.kedb.find(x => x.id === k); if (found) openArticle(found); setLocation('/services', { replace: true }); } }, [search, store.kedb, setLocation]);

  const matches = store.services.filter(s => (category === 'Toutes' || s.category === category) && `${s.name} ${s.category} ${s.owner}`.toLowerCase().includes(query.toLowerCase()));
  const publishedArticles = store.kedb.filter(a => a.reviewStatus === 'published');
  const kedb = useMemo(() => store.kedb
    .filter(a => a.reviewStatus === 'published' || (canReviewKedb && !readOnlyAuditor))
    .filter(a => `${a.id} ${a.title} ${a.symptom} ${a.rootCause} ${a.resolution} ${a.ticketId} ${a.category}`.toLowerCase().includes(kq.toLowerCase())), [store.kedb, kq, canReviewKedb, readOnlyAuditor]);
  const svc = store.services.find(s => s.id === service);
  const openCount = (id: string) => store.tickets.filter(t => t.serviceId === id && t.status !== 'Clos' && t.status !== 'Rejeté').length;
  const articleStatus = (value: KedbArticle) => value.reviewStatus ?? 'pending';
  const reviewable = article !== null && canReviewKedb && articleStatus(article) !== 'published';
  const submitReview = async (decision: 'publish' | 'request_changes') => {
    if (!article) return;
    setReviewError('');
    try {
      const result = await reviewArticle.mutateAsync({
        articleId: article.id,
        data: {
          decision,
          title: reviewDraft.title,
          symptom: reviewDraft.symptom,
          rootCause: reviewDraft.rootCause,
          resolution: reviewDraft.resolution,
          comment: reviewComment,
        },
      });
      const updated = result.article as KedbArticle;
      setStore(current => ({ ...current, kedb: current.kedb.map(value => value.id === updated.id ? updated : value) }));
      setArticle(updated);
      setReviewDraft({ title: updated.title, symptom: updated.symptom, rootCause: updated.rootCause, resolution: updated.resolution });
      setReviewComment(updated.reviewFeedback ?? '');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'La revue n’a pas pu être enregistrée.');
    }
  };

  return <div className="page-enter min-w-0"><Warning /><PageIntro kicker="RÉFÉRENTIEL OPÉRATIONNEL" title="Des repères pour avancer." description={readOnlyAuditor ? 'Consultation en lecture seule de la base d’erreurs connues.' : 'Disponibilité des outils, procédures et erreurs connues, dans un environnement fictif.'} action={!readOnlyAuditor && <Link href="/tickets?new=1" className="focus-ring inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-[12px] font-semibold text-primary-foreground"><Plus size={15} />Nouvelle demande</Link>} />
    {readOnlyAuditor ? <div className="mb-6"><MiniStat icon={BookOpen} label="Articles KEDB consultables" value={pad2(publishedArticles.length)} /></div> : <div className="mb-6 grid gap-3 sm:grid-cols-3"><MiniStat icon={Check} label="Services opérationnels" value={`${store.services.filter(s => s.status === 'Opérationnel').length} sur ${store.services.length}`} /><MiniStat icon={AlertTriangle} label="Vigilance en cours" value={pad2(store.services.filter(s => s.status === 'Vigilance').length)} /><MiniStat icon={BookOpen} label="Articles KEDB publiés" value={pad2(publishedArticles.length)} /></div>}
     {!readOnlyAuditor && <DiagnosticAssistant services={store.services} articles={publishedArticles} onOpenArticle={openArticle} onLog={log} />}
    <section className={readOnlyAuditor ? 'hidden' : 'panel p-5 md:p-6'}><SectionTitle kicker="CATALOGUE" title="Services disponibles" /><div className="mb-4 grid gap-2 sm:grid-cols-[1fr_190px]"><SearchBox testId="input-search-services" value={query} onChange={setQuery} placeholder="Rechercher un service" /><select aria-label="Catégorie de service" value={category} onChange={e => setCategory(e.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-[11px]"><option>Toutes</option>{Array.from(new Set(store.services.map(s => s.category))).map(c => <option key={c}>{c}</option>)}</select></div>
      <div className="grid gap-3 md:grid-cols-2">{matches.map((s, i) => <div key={s.id} className="rounded-xl border border-border p-4 transition hover:border-primary/40"><div className="flex items-start justify-between gap-2"><div className={`grid h-9 w-9 place-items-center rounded-lg ${i % 2 ? 'bg-[#efe8d8] text-[#927547] dark:bg-[#483b25] dark:text-[#e5c78e]' : 'bg-[#e1eee7] text-[#347156] dark:bg-[#25443a] dark:text-[#aed9c2]'}`}><Wifi size={17} /></div><div className="flex items-center gap-1.5">{openCount(s.id) > 0 && <Badge tone="blue">{openCount(s.id)} ticket(s)</Badge>}<Badge tone={s.status === 'Vigilance' ? 'amber' : 'green'}>{s.status}</Badge></div></div><div className="mt-3 text-[14px] font-semibold">{s.name}</div><p className="mt-1.5 min-h-[38px] text-[11px] leading-relaxed text-muted-foreground">{s.description}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-[10px]"><span className="text-muted-foreground">{s.owner} · {s.sla}</span><div className="flex items-center gap-3"><button data-testid={`button-service-details-${s.id}`} onClick={() => { log(`Service « ${s.name} » consulté`, 'Catalogue des services'); setService(s.id); }} className="font-semibold text-muted-foreground hover:text-foreground hover:underline">Détails</button><Link data-testid={`link-request-${s.id}`} href={`/tickets?new=1&service=${s.id}`} className="font-semibold text-primary hover:underline">Demander <ArrowRight className="ml-0.5 inline" size={12} /></Link></div></div></div>)}</div>{!matches.length && <EmptyState title="Aucun service correspondant" text="Modifiez la recherche ou choisissez une autre catégorie." />}</section>

    <section className="panel mt-5 p-5 md:p-6"><SectionTitle kicker="KEDB · BASE D’ERREURS CONNUES" title="Base de connaissances" action={<div className="w-full sm:w-72"><SearchBox testId="input-search-kedb" value={kq} onChange={setKq} placeholder="Symptôme, cause, ticket…" /></div>} />
      <p className="mb-3 text-[11px] text-muted-foreground">Les fiches issues des tickets clos sont relues avant leur publication comme solutions en libre-service.</p>
      {kedb.length ? <div className="divide-y divide-border/70">{kedb.map(a => <button key={a.id} data-testid={`row-kedb-${a.id}`} onClick={() => { openArticle(a); log(`Article ${a.id} consulté`, 'Base d’erreurs connues'); }} className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-muted/40"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#e1eaf0] text-[#3b6177] dark:bg-[#263c4a] dark:text-[#a8c8d8]"><BookOpen size={16} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-[12px] font-semibold">{a.title}</span>{articleStatus(a) !== 'published' && <Badge tone={articleStatus(a) === 'needs_revision' ? 'amber' : 'blue'}>{articleStatus(a) === 'needs_revision' ? 'Corrections demandées' : 'À valider'}</Badge>}</div><div className="mt-1 text-[10px] text-muted-foreground"><span className="mono">{a.id}</span> <span className="mx-1">·</span>source {a.ticketId}<span className="mx-1">·</span>{formatWAT(a.createdAt, 'date')}</div></div><ArrowRight size={15} className="text-muted-foreground" /></button>)}</div>
          : <EmptyState title={store.kedb.length ? 'Aucun article ne correspond' : 'Aucune résolution à consulter pour l’instant'} text={store.kedb.length ? 'Essayez un autre terme.' : 'Les articles sont créés à la clôture d’un ticket puis publiés après revue.'} action={!readOnlyAuditor && !store.kedb.length ? <Link href="/tickets" className="text-[11px] font-semibold text-primary hover:underline">Aller aux tickets</Link> : undefined} />}
    </section>

    <section className="panel mt-5 p-5 md:p-6"><SectionTitle kicker="GUIDES PRATIQUES" title="Procédures courantes" action={<div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Headphones size={13} />{guides.length} fiches de démonstration</div>} /><div className="divide-y divide-border/70">{guides.map(a => <button key={a.title} onClick={() => { log(`Guide « ${a.title} » consulté`, 'Base de connaissances'); setGuide(a.title); }} className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-muted/40"><div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground"><FileText size={16} /></div><div className="flex-1"><div className="text-[12px] font-semibold">{a.title}</div><div className="mt-1 text-[10px] text-muted-foreground">{a.category} <span className="mx-1">·</span>{a.time} de lecture</div></div><ArrowRight size={15} className="text-muted-foreground" /></button>)}</div></section>

    {guide && <Modal title={guide} onClose={() => setGuide(null)}><p className="text-[12px] leading-7 text-muted-foreground">{guides.find(a => a.title === guide)?.body}</p><div className="mt-5 rounded-lg bg-muted/70 p-3 text-[10px] leading-relaxed text-muted-foreground">Fiche fictive de prototype. Les procédures officielles restent celles communiquées par l’agence.</div><div className="mt-4 flex justify-end"><Button onClick={() => setGuide(null)}>Fermer</Button></div></Modal>}
    {svc && <Modal title={svc.name} description={`${svc.category} · ${svc.owner}`} onClose={() => setService(null)}><p className="break-words text-[12px] leading-relaxed text-muted-foreground">{svc.description}</p><div className="mt-4 grid min-w-0 grid-cols-2 gap-2">{[['État', svc.status], ['Engagement affiché', svc.sla], ['Tickets ouverts', String(openCount(svc.id))], ['Référence', svc.id]].map(([k, v]) => <div key={k} className="min-w-0 rounded-lg bg-muted/60 p-3"><div className="eyebrow">{k}</div><div className="mt-1 break-words text-[11px] font-semibold">{v}</div></div>)}</div><div data-dialog-sticky-actions className={`${dialogStickyActionsCls} mt-5`}><Button className="w-full sm:w-auto" variant="outline" onClick={() => setService(null)}>Fermer</Button><Link href={`/tickets?new=1&service=${svc.id}`} className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-[12px] font-semibold text-primary-foreground sm:w-auto"><Plus size={14} />Demander ce service</Link></div></Modal>}
    {article && <Modal wide title={article.title} description={`${article.id} · créé le ${formatWAT(article.createdAt, 'datetime')} par ${person(article.author)}`} onClose={() => setArticle(null)}>
      <div className="mb-4 flex flex-wrap items-center gap-2"><Badge tone={articleStatus(article) === 'published' ? 'green' : articleStatus(article) === 'needs_revision' ? 'amber' : 'blue'}>{articleStatus(article) === 'published' ? 'Publié' : articleStatus(article) === 'needs_revision' ? 'Corrections demandées' : 'À valider'}</Badge>{article.reviewedAt && <span className="text-[10px] text-muted-foreground">Revu le {formatWAT(article.reviewedAt, 'datetime')} par {person(article.reviewedBy ?? '')}</span>}</div>
      {article.reviewFeedback && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px]"><strong>Retour de revue :</strong> {article.reviewFeedback}</div>}
      {reviewable ? <div className="space-y-3">
        <Field label="Titre"><input data-testid="input-kedb-review-title" value={reviewDraft.title} onChange={e => setReviewDraft(value => ({ ...value, title: e.target.value }))} className={inputCls} maxLength={180} /></Field>
        <Field label="Symptôme"><textarea data-testid="input-kedb-review-symptom" value={reviewDraft.symptom} onChange={e => setReviewDraft(value => ({ ...value, symptom: e.target.value }))} className={textareaCls} rows={3} maxLength={4000} /></Field>
        <Field label="Cause racine"><textarea data-testid="input-kedb-review-root-cause" value={reviewDraft.rootCause} onChange={e => setReviewDraft(value => ({ ...value, rootCause: e.target.value }))} className={textareaCls} rows={3} maxLength={4000} /></Field>
        <Field label="Résolution"><textarea data-testid="input-kedb-review-resolution" value={reviewDraft.resolution} onChange={e => setReviewDraft(value => ({ ...value, resolution: e.target.value }))} className={textareaCls} rows={4} maxLength={8000} /></Field>
        <Field label="Commentaire de revue" hint="Obligatoire pour demander des corrections."><textarea data-testid="input-kedb-review-comment" value={reviewComment} onChange={e => setReviewComment(e.target.value)} className={textareaCls} rows={2} maxLength={500} placeholder="Précisez les corrections attendues…" /></Field>
        {reviewError && <p data-testid="status-kedb-review-error" role="alert" className="text-[11px] text-destructive">{reviewError}</p>}
      </div> : <div className="space-y-3 text-[12px]">{[['Symptôme', article.symptom], ['Cause racine', article.rootCause], ['Résolution', article.resolution]].map(([k, v]) => <div key={k} className="rounded-lg border border-border p-3"><div className="eyebrow">{k}</div><p className="mt-1 whitespace-pre-wrap leading-relaxed">{v}</p></div>)}</div>}
      <div data-dialog-sticky-actions className={`${dialogStickyActionsCls} mt-5`}>
        <Button variant="outline" onClick={() => setArticle(null)}>Fermer</Button>
        {!readOnlyAuditor && article.reviewStatus === 'published' && <Link data-testid="link-kedb-source" href={`/tickets?ticket=${encodeURIComponent(article.ticketId)}`} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-[12px] font-semibold text-primary-foreground">Ticket source {article.ticketId}<ArrowRight size={13} /></Link>}
        {reviewable && <>
          <Button testId="button-kedb-request-changes" variant="outline" disabled={reviewArticle.isPending || !reviewComment.trim()} onClick={() => void submitReview('request_changes')}>Demander corrections</Button>
          <Button testId="button-kedb-publish" disabled={reviewArticle.isPending} onClick={() => void submitReview('publish')}>{reviewArticle.isPending ? 'Enregistrement…' : 'Publier après revue'}</Button>
        </>}
      </div>
    </Modal>}
  </div>;
}
