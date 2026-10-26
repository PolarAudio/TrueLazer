import React from 'react';
import { translate } from '../i18n/translate';
import { DEFAULT_LOCALE } from '../i18n/translations';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <h1>{translate(DEFAULT_LOCALE, 'errorBoundary.title')}</h1>;
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;