import * as React from "react";
import "./styles.scss";
import classNames from "classnames";
import { MdAutorenew } from "react-icons/md";

interface OverviewCardProps {
    onExit: () => void;
    onToggle: () => void;
}

const OverviewCard = ({ onExit, onToggle }: OverviewCardProps) => {
    const [visibility, setVisibility] = React.useState(true);

    const overviewCardTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const hideCard = (timeout = 3000) => {
        if (overviewCardTimer.current) clearTimeout(overviewCardTimer.current);
        setVisibility(true);
        overviewCardTimer.current = setTimeout(() => {
            setVisibility(false);
        }, timeout);
    };

    const handleMouseMove = (evt: MouseEvent) => {
        // Show card when mouse is on the top side of the screen and centered horizantally
        if (
            evt.clientY / window.innerHeight < 0.15 &&
            evt.clientX / window.innerWidth > 0.3 &&
            evt.clientX / window.innerWidth < 0.7
        ) {
            hideCard();
        }
    };

    React.useEffect(() => {
        if (overviewCardTimer.current) clearTimeout(overviewCardTimer.current);
        hideCard();
        document.addEventListener("mousemove", handleMouseMove);

        return () => {
            if (overviewCardTimer.current) clearTimeout(overviewCardTimer.current);
            document.removeEventListener("mousemove", handleMouseMove);
        };
    }, []);

    return (
        <div
            id="fsd-overview-card"
            className={classNames({
                "c-hidden": !visibility,
            })}>
            <div id="fsd-overview-button-container">
                <Spicetify.ReactComponent.TooltipWrapper label="Toggle Mode" placement="bottom">
                    <button
                        id="overview-toggle-button"
                        className="fsd-overview-button"
                        onClick={onToggle}>
                        <MdAutorenew />
                    </button>
                </Spicetify.ReactComponent.TooltipWrapper>

                <Spicetify.ReactComponent.TooltipWrapper label="Exit" placement="bottom">
                    <button
                        id="overview-exit-button"
                        className="fsd-overview-button"
                        dangerouslySetInnerHTML={{
                            __html: `<svg width="1.5em" height="1.5em" viewBox="0 0 16 16" fill="currentColor">${
                                Spicetify.SVGIcons.x
                            }</svg>`,
                        }}
                        onClick={onExit}
                    />
                </Spicetify.ReactComponent.TooltipWrapper>
            </div>
        </div>
    );
};

export default OverviewCard;
