export class SiteHistory {
  private urls: string[] = [];

  private index = -1;

  private browserLength = 0;

  recordDocument(url: string, browserLength: number) {
    this.urls = [url];
    this.index = 0;
    this.browserLength = browserLength;
  }

  recordInPage(url: string, browserLength: number) {
    if (this.index < 0) {
      this.recordDocument(url, browserLength);
      return;
    }
    if (this.urls[this.index] === url) return;

    if (this.index > 0 && this.urls[this.index - 1] === url) {
      this.index -= 1;
    } else if (
      this.index < this.urls.length - 1 &&
      this.urls[this.index + 1] === url
    ) {
      this.index += 1;
    } else if (
      browserLength > this.browserLength ||
      this.index < this.urls.length - 1
    ) {
      this.urls.splice(this.index + 1);
      this.urls.push(url);
      this.index += 1;
    } else {
      this.urls[this.index] = url;
    }
    this.browserLength = browserLength;
  }

  canGoBack() {
    return this.index > 0;
  }

  canGoForward() {
    return this.index >= 0 && this.index < this.urls.length - 1;
  }
}
