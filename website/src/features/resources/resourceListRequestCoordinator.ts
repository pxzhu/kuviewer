export type ResourceListRequestKind = 'primary' | 'page';

export interface ResourceListRequestTicket {
  generation: number;
  kind: ResourceListRequestKind;
  signal: AbortSignal;
}

export class ResourceListRequestCoordinator {
  private generation = 0;
  private primaryController: AbortController | null = null;
  private pageController: AbortController | null = null;

  beginPrimary(): ResourceListRequestTicket {
    this.invalidate();
    this.primaryController = new AbortController();
    return this.ticket('primary', this.primaryController);
  }

  beginPage(): ResourceListRequestTicket {
    this.pageController?.abort();
    this.pageController = new AbortController();
    return this.ticket('page', this.pageController);
  }

  isCurrent(ticket: ResourceListRequestTicket) {
    const activeController = ticket.kind === 'primary' ? this.primaryController : this.pageController;
    return ticket.generation === this.generation && !ticket.signal.aborted && activeController?.signal === ticket.signal;
  }

  finish(ticket: ResourceListRequestTicket) {
    if (!this.isCurrent(ticket)) return false;
    if (ticket.kind === 'primary') this.primaryController = null;
    else this.pageController = null;
    return true;
  }

  cancelGeneration(generation: number) {
    if (generation !== this.generation) return false;
    this.invalidate();
    return true;
  }

  invalidate() {
    this.generation += 1;
    this.primaryController?.abort();
    this.pageController?.abort();
    this.primaryController = null;
    this.pageController = null;
  }

  private ticket(kind: ResourceListRequestKind, controller: AbortController): ResourceListRequestTicket {
    return { generation: this.generation, kind, signal: controller.signal };
  }
}
