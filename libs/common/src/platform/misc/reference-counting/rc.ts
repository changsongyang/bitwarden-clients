export type Freeable = { free: () => void };

/**
 * Reference counted disposable value.
 * This class is used to manage the lifetime of a value that needs to be
 * freed of at a specific time but might still be in-use when that happens.
 */
export class Rc<T extends Freeable> {
  private markedForDisposal = false;
  private refCount = 0;
  private value: T;

  constructor(value: T) {
    this.value = value;
  }

  /**
   * Use this function when you want to use it. This will guarantee
   * that you have a reference to the value and it won't be freed until
   * your reference goes out of scope.
   * @returns The value.
   */
  take(): Ref<T> {
    if (this.markedForDisposal) {
      throw new Error("Cannot take a reference to a value marked for disposal");
    }

    this.refCount++;
    return new Ref(() => this.release(), this.value);
  }

  /**
   * Mark this Rc for disposal. When the refCount reaches 0, the value
   * will be freed.
   */
  markForDisposal() {
    this.markedForDisposal = true;
    this.freeIfPossible();
  }

  private release() {
    this.refCount--;
    this.freeIfPossible();
  }

  private freeIfPossible() {
    if (this.refCount === 0 && this.markedForDisposal) {
      this.value.free();
    }
  }
}

export class Ref<T extends Freeable> {
  constructor(
    private readonly release: () => void,
    readonly value: T,
  ) {}

  [Symbol.dispose]() {
    this.release();
  }
}
